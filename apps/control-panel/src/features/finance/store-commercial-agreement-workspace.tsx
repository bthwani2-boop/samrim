"use client";

import { useCallback, useEffect, useState } from "react";

import { useSession } from "../../session/session-provider";
import type { FinanceStoreCommercialAgreement, StoreCommercialAgreementDecision, StoreCommercialAgreementDecisionResponse, StoreCommercialAgreementQueueResponse, StoreCommercialAgreementRecord, StoreTypeCommissionDefaultsResponse } from "./store-commercial-agreement-types";
import { storeCommercialAgreementModes } from "./store-commercial-agreement-types";

const queueLimit = 50;

type PendingDecisionAttempt = Readonly<{
  operatorActorId: string;
  storeId: string;
  agreementId: string;
  partnerActorId: string;
  storeName: string;
  decision: StoreCommercialAgreementDecision;
  reason: string;
  expectedAgreementVersion: number;
  idempotencyKey: string;
  correlationId: string;
  createdAt: string;
}>;

type VerifiedDecision = Readonly<{
  attempt: PendingDecisionAttempt;
  agreement: StoreCommercialAgreementRecord;
}>;

function pendingAttemptStorageKey(operatorActorId: string) {
  return `finance.store-commercial-agreement.pending.${encodeURIComponent(operatorActorId)}`;
}

function parsePendingAttempt(value: unknown, operatorActorId: string): PendingDecisionAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Partial<PendingDecisionAttempt>;
  if (attempt.operatorActorId !== operatorActorId || typeof attempt.storeId !== "string" || !attempt.storeId.trim() || attempt.storeId.length > 128 ||
    typeof attempt.agreementId !== "string" || !attempt.agreementId.trim() || attempt.agreementId.length > 128 || typeof attempt.partnerActorId !== "string" || !attempt.partnerActorId.trim() || attempt.partnerActorId.length > 128 || typeof attempt.storeName !== "string" ||
    (attempt.decision !== "APPROVE" && attempt.decision !== "REJECT") || typeof attempt.reason !== "string" || Array.from(attempt.reason.trim()).length < 8 || Array.from(attempt.reason.trim()).length > 500 ||
    !Number.isInteger(attempt.expectedAgreementVersion) || Number(attempt.expectedAgreementVersion) < 1 || typeof attempt.idempotencyKey !== "string" || attempt.idempotencyKey.length < 8 || attempt.idempotencyKey.length > 128 ||
    typeof attempt.correlationId !== "string" || attempt.correlationId.length < 8 || attempt.correlationId.length > 128 || typeof attempt.createdAt !== "string") return null;
  return { ...attempt, reason: attempt.reason.trim() } as PendingDecisionAttempt;
}

function validateDecisionReadback(agreement: StoreCommercialAgreementRecord, attempt: PendingDecisionAttempt): string | null {
  const expectedStatus = attempt.decision === "APPROVE" ? "ACTIVE" : "FINANCE_REJECTED";
  if (agreement.agreementId !== attempt.agreementId || agreement.storeId !== attempt.storeId || agreement.partnerActorId !== attempt.partnerActorId) return "قراءة DSH لا تطابق معرّف الاتفاق والمتجر والشريك المحفوظين.";
  if (agreement.agreementVersion !== attempt.expectedAgreementVersion) return "إصدار الاتفاق في قراءة DSH لا يطابق الإصدار المحفوظ للمحاولة.";
  if (agreement.status !== expectedStatus) return `الحالة المقروءة هي ${agreement.status} والمتوقعة ${expectedStatus}؛ بقيت المحاولة محفوظة ولم يُعلن نجاحها.`;
  if (agreement.financeDecisionByActorId !== attempt.operatorActorId || !agreement.financeDecisionAt) return "قراءة DSH لا تثبت أن موظف Finance الحالي سجّل القرار.";
  if (agreement.financeDecisionReason !== attempt.reason) return "سبب القرار في قراءة DSH لا يطابق السبب المحفوظ للمحاولة.";
  if (attempt.decision === "APPROVE" && (agreement.financeApprovedByActorId !== attempt.operatorActorId || !agreement.financeApprovedAt)) return "قراءة DSH لا تثبت اعتماد الاتفاق بواسطة موظف Finance الحالي.";
  return null;
}

function formatPercent(rateBps: number) {
  return `${(rateBps / 100).toFixed(2)}%`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "غير مسجل";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status: FinanceStoreCommercialAgreement["status"]) {
  switch (status) {
    case "PROPOSED": return "بانتظار قبول مالك المتجر";
    case "PARTNER_ACCEPTED": return "بانتظار قرار Finance";
    case "ACTIVE": return "نشط";
    case "FINANCE_REJECTED": return "مرفوض من Finance";
    case "SUPERSEDED": return "استبدل باتفاق أحدث";
  }
}

function errorMessage(value: unknown) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return "تعذر إكمال طلب الاتفاق التجاري.";
}

function modeLabel(mode: string) {
  return storeCommercialAgreementModes.find((item) => item.key === mode)?.label ?? mode;
}

export function StoreCommercialAgreementWorkspace() {
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" && sessionState.identity.permissions?.includes("finance") ? sessionState.identity.subject : "";
  const [agreements, setAgreements] = useState<readonly FinanceStoreCommercialAgreement[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [selectedAgreementId, setSelectedAgreementId] = useState("");
  const [defaults, setDefaults] = useState<StoreTypeCommissionDefaultsResponse | null>(null);
  const [defaultsTypeId, setDefaultsTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"queue" | "more" | "defaults" | "readback" | "APPROVE" | "REJECT" | null>("queue");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<PendingDecisionAttempt | null>(null);
  const [pendingStorageReady, setPendingStorageReady] = useState(false);
  const [pendingStorageError, setPendingStorageError] = useState("");
  const [verifiedDecision, setVerifiedDecision] = useState<VerifiedDecision | null>(null);

  useEffect(() => {
    setPendingAttempt(null);
    setPendingStorageError("");
    if (!operatorActorId) {
      setPendingStorageReady(false);
      return;
    }
    setPendingStorageReady(false);
    try {
      const stored = window.sessionStorage.getItem(pendingAttemptStorageKey(operatorActorId));
      if (stored) {
        const parsed = parsePendingAttempt(JSON.parse(stored) as unknown, operatorActorId);
        if (!parsed) {
          setPendingStorageError("تعذر التحقق من المحاولة المحفوظة لهذه الجلسة؛ لن يُرسل أي قرار حتى معالجة سجل الجلسة.");
        } else {
          setPendingAttempt(parsed);
          setReason(parsed.reason);
        }
      }
    } catch {
      setPendingStorageError("تعذر قراءة تخزين الجلسة؛ لن يُرسل أي قرار قبل توفر حفظ المحاولة.");
    } finally {
      setPendingStorageReady(true);
    }
  }, [operatorActorId]);

  const readQueue = useCallback(async (cursor = "", append = false) => {
    setBusy(append ? "more" : "queue");
    setError("");
    setMessage("");
    try {
      const query = new URLSearchParams({ limit: String(queueLimit) });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/finance/store-commercial-agreements?${query.toString()}`, { cache: "no-store" });
      const body = await response.json() as Partial<StoreCommercialAgreementQueueResponse> & { error?: { message?: string } };
      if (!response.ok || !Array.isArray(body.agreements)) throw new Error(errorMessage(body));
      const items = body.agreements as readonly FinanceStoreCommercialAgreement[];
      setAgreements((current) => append ? [...current, ...items.filter((item) => !current.some((existing) => existing.agreementId === item.agreementId))] : items);
      setNextCursor(typeof body.nextCursor === "string" ? body.nextCursor : "");
      if (!append) {
        setSelectedAgreementId("");
        setDefaults(null);
        setDefaultsTypeId("");
      }
      if (!items.length && !append) setMessage("لا توجد اتفاقات بانتظار قرار Finance حاليًا.");
    } catch (cause) {
      if (!append) setAgreements([]);
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الاتفاقات المعلقة.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void readQueue(); }, [readQueue]);

  const selected = agreements.find((item) => item.agreementId === selectedAgreementId);

  async function selectAgreement(agreement: FinanceStoreCommercialAgreement) {
    setSelectedAgreementId(agreement.agreementId);
    setDefaults(null);
    setDefaultsTypeId(agreement.commercialStoreTypeId ?? "");
    setError("");
    setMessage("");
    if (!agreement.commercialStoreTypeId) return;
    setBusy("defaults");
    try {
      const query = new URLSearchParams({ commercialStoreTypeId: agreement.commercialStoreTypeId });
      const response = await fetch(`/api/finance/commercial-store-type-commission-defaults?${query.toString()}`, { cache: "no-store" });
      const body = await response.json() as Partial<StoreTypeCommissionDefaultsResponse> & { error?: { message?: string } };
      if (!response.ok || body.commercialStoreTypeId !== agreement.commercialStoreTypeId || !Array.isArray(body.defaults)) throw new Error(errorMessage(body));
      setDefaults(body as StoreTypeCommissionDefaultsResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل قيم العمولة المرجعية.");
    } finally {
      setBusy(null);
    }
  }

  function savePendingAttempt(attempt: PendingDecisionAttempt): boolean {
    if (!operatorActorId || attempt.operatorActorId !== operatorActorId) {
      setPendingStorageError("لا تطابق هوية Finance الحالية هوية المحاولة.");
      return false;
    }
    try {
      window.sessionStorage.setItem(pendingAttemptStorageKey(operatorActorId), JSON.stringify(attempt));
      setPendingAttempt(attempt);
      setPendingStorageError("");
      return true;
    } catch {
      setPendingStorageError("تعذر حفظ المحاولة في sessionStorage؛ لم يُرسل القرار.");
      return false;
    }
  }

  function clearPendingAttempt(attempt: PendingDecisionAttempt): boolean {
    try {
      window.sessionStorage.removeItem(pendingAttemptStorageKey(attempt.operatorActorId));
      setPendingAttempt(null);
      setPendingStorageError("");
      return true;
    } catch {
      setPendingStorageError("تم التحقق من القرار، لكن تعذر حذف المحاولة المحفوظة. استخدم تحقق القراءة مرة أخرى قبل بدء قرار جديد.");
      return false;
    }
  }

  function finishVerifiedAttempt(agreement: StoreCommercialAgreementRecord, attempt: PendingDecisionAttempt) {
    const validationError = validateDecisionReadback(agreement, attempt);
    if (validationError) {
      setError(validationError);
      return false;
    }
    const cleared = clearPendingAttempt(attempt);
    setVerifiedDecision({ attempt, agreement });
    setAgreements((current) => current.filter((item) => item.agreementId !== attempt.agreementId));
    if (selectedAgreementId === attempt.agreementId) setSelectedAgreementId("");
    setDefaults(null);
    setDefaultsTypeId("");
    if (cleared) {
      setReason("");
      setMessage(attempt.decision === "APPROVE" ? "تم التحقق من الاعتماد عبر قراءة DSH المطابقة." : "تم التحقق من الرفض عبر قراءة DSH المطابقة.");
    } else {
      setMessage("تم التحقق من القرار عبر قراءة DSH. بقي سجل المحاولة المحلي محفوظًا بسبب تعذر حذفه؛ لا تبدأ قرارًا جديدًا قبل إعادة التحقق.");
    }
    setError("");
    return true;
  }

  async function submitPendingAttempt(attempt: PendingDecisionAttempt) {
    if (!operatorActorId || attempt.operatorActorId !== operatorActorId) {
      setError("المحاولة المحفوظة لا تخص موظف Finance الحالي.");
      return;
    }
    setBusy(attempt.decision);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/finance/store-commercial-agreements/${encodeURIComponent(attempt.storeId)}/${encodeURIComponent(attempt.agreementId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId },
        body: JSON.stringify({ expectedAgreementVersion: attempt.expectedAgreementVersion, decision: attempt.decision, reason: attempt.reason }),
      });
      const body = await response.json() as Partial<StoreCommercialAgreementDecisionResponse> & { error?: { message?: string } };
      if (!response.ok || !body.agreement) throw new Error(errorMessage(body));
      if (!finishVerifiedAttempt(body.agreement, attempt)) setMessage("وصل رد القرار، لكن لم يطابق إثبات DSH المطلوب. بقيت المحاولة محفوظة للتحقق الصريح.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "تعذر تأكيد نتيجة القرار"} بقيت المحاولة نفسها محفوظة؛ أعد إرسالها صراحةً بالمفتاح نفسه أو تحقق من قراءة DSH.`);
    } finally {
      setBusy(null);
    }
  }

  async function verifyPendingAttempt(attempt: PendingDecisionAttempt) {
    if (!operatorActorId || attempt.operatorActorId !== operatorActorId) {
      setError("المحاولة المحفوظة لا تخص موظف Finance الحالي.");
      return;
    }
    setBusy("readback");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/finance/store-commercial-agreements/${encodeURIComponent(attempt.storeId)}`, { cache: "no-store" });
      const body = await response.json() as { agreements?: readonly StoreCommercialAgreementRecord[]; error?: { message?: string } };
      if (!response.ok || !Array.isArray(body.agreements)) throw new Error(errorMessage(body));
      const matches = body.agreements.filter((agreement) => agreement.agreementId === attempt.agreementId);
      if (matches.length !== 1) throw new Error("لم تُرجع قراءة DSH سجلًا وحيدًا مطابقًا للاتفاق؛ بقيت المحاولة محفوظة.");
      const readback = matches[0];
      if (!readback) throw new Error("تعذر تحديد سجل الاتفاق المطابق في قراءة DSH؛ بقيت المحاولة محفوظة.");
      if (!finishVerifiedAttempt(readback, attempt)) setMessage("لم تثبت قراءة DSH النتيجة المطابقة؛ بقيت المحاولة محفوظة ويمكن إعادة المحاولة صراحةً.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "تعذرت قراءة الاتفاق من DSH"} لم يُرسل أي قرار جديد.`);
    } finally {
      setBusy(null);
    }
  }

  function beginDecision(decision: StoreCommercialAgreementDecision) {
    if (!selected || !operatorActorId || !pendingStorageReady || pendingAttempt || pendingStorageError || busy !== null || selected.status !== "PARTNER_ACCEPTED" ||
      !selected.matchesCurrentFulfillmentModes || selected.partnerAcceptedByActorId !== selected.partnerActorId || selected.currentStoreOwnerActorId !== selected.partnerActorId ||
      Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) {
      setError("لا يمكن بدء القرار: تحقق من صلاحية Finance والقبول والمالك والأنماط والسبب، أو احسم المحاولة السابقة أولًا.");
      return;
    }
    const attempt: PendingDecisionAttempt = {
      operatorActorId,
      storeId: selected.storeId,
      agreementId: selected.agreementId,
      partnerActorId: selected.partnerActorId,
      storeName: selected.storeName,
      decision,
      reason: reason.trim(),
      expectedAgreementVersion: selected.agreementVersion,
      idempotencyKey: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    if (!savePendingAttempt(attempt)) return;
    setVerifiedDecision(null);
    void submitPendingAttempt(attempt);
  }

  return <section className="access-card" aria-labelledby="store-commercial-agreement-title">
    <div className="finance-toolbar">
      <div><p className="eyebrow">قرار صريح بصلاحية Finance · سجل الاتفاقات في DSH/WLT</p><h2 id="store-commercial-agreement-title">اتفاقات المتاجر التجارية</h2></div>
      <button className="button button-secondary" type="button" onClick={() => void readQueue()} disabled={busy !== null}>{busy === "queue" ? "جارٍ التحديث…" : "تحديث طابور Finance"}</button>
    </div>
    <p className="muted">يعرض هذا الطابور الاتفاقات التي قبلها مالك المتجر وتنتظر قرار Finance. نسب الاتفاق ملزمة كما أرسلها Field؛ القيم الافتراضية ظاهرة كمرجع منفصل ولا تُنسخ أو تعتمد تلقائيًا. لا يحدث اعتماد أو رفض دون اختيار Finance الصريح وإدخال سبب موثق.</p>

    {pendingStorageError ? <p className="validation-error" role="alert">{pendingStorageError}</p> : null}
    {!pendingStorageReady && operatorActorId ? <p role="status">جارٍ التحقق من المحاولة المحفوظة لهذه الجلسة…</p> : null}
    {pendingAttempt ? <section className="access-card" aria-labelledby="pending-store-commercial-decision-title">
      <p className="eyebrow">محاولة Finance محفوظة ولم تُرسل تلقائيًا</p>
      <h3 id="pending-store-commercial-decision-title">{pendingAttempt.storeName || pendingAttempt.storeId}</h3>
      <p className="muted">القرار: {pendingAttempt.decision === "APPROVE" ? "اعتماد" : "رفض"} · الاتفاق {pendingAttempt.agreementId} · الإصدار المتوقع {pendingAttempt.expectedAgreementVersion}</p>
      <p className="muted">الموظف: {pendingAttempt.operatorActorId} · سبب القرار: {pendingAttempt.reason} · وقت حفظ المحاولة: {formatTimestamp(pendingAttempt.createdAt)}</p>
      <details><summary>معرّفات إعادة المحاولة</summary><p className="muted">Idempotency-Key: {pendingAttempt.idempotencyKey}</p><p className="muted">X-Correlation-ID: {pendingAttempt.correlationId}</p></details>
      <div className="finance-toolbar">
        <button className="button button-primary" type="button" onClick={() => void submitPendingAttempt(pendingAttempt)} disabled={busy !== null || pendingAttempt.operatorActorId !== operatorActorId}>{busy === pendingAttempt.decision ? "جارٍ إعادة المحاولة…" : "إعادة إرسال المحاولة نفسها"}</button>
        <button className="button button-secondary" type="button" onClick={() => void verifyPendingAttempt(pendingAttempt)} disabled={busy !== null || pendingAttempt.operatorActorId !== operatorActorId}>{busy === "readback" ? "جارٍ التحقق من DSH…" : "تحقق من النتيجة بقراءة DSH"}</button>
      </div>
      <p className="muted">إعادة الإرسال تستخدم القرار والسبب والإصدار ومفتاحي التتبع المحفوظة نفسها. لا تُنشأ محاولة جديدة تلقائيًا.</p>
    </section> : null}

    {busy === "queue" && agreements.length === 0 ? <p role="status">جارٍ تحميل الاتفاقات…</p> : null}
    {agreements.length ? <section className="form-grid" aria-label="اتفاقات بانتظار Finance">
      {agreements.map((agreement) => <article className="access-card" key={agreement.agreementId}>
        <div className="finance-toolbar"><div><p className="eyebrow">الإصدار {agreement.agreementVersion} · {agreement.agreementId}</p><h3>{agreement.storeName || agreement.storeId}</h3></div><strong>{statusLabel(agreement.status)}</strong></div>
        <p className="muted">المتجر: {agreement.storeId} · مالك المتجر الحالي: {agreement.currentStoreOwnerActorId || "غير متاح"}</p>
        <p className="muted">الأنماط الحالية: {agreement.fulfillmentModes.map(modeLabel).join("، ") || "غير محددة"}</p>
        <p className="muted">أرسل الاتفاق: {agreement.proposedByActorId} · {formatTimestamp(agreement.proposedAt)}</p>
        <p className="muted">قبله الشريك: {agreement.partnerAcceptedByActorId ?? "غير مسجل"} · {formatTimestamp(agreement.partnerAcceptedAt)}</p>
        {!agreement.matchesCurrentFulfillmentModes ? <p className="validation-error" role="alert">الأنماط الحالية لا تطابق نسب الاتفاق؛ لن يُتاح قرار Finance حتى تصحيح الحالة في المالك القانوني.</p> : null}
        <button className="button button-secondary" type="button" aria-pressed={selectedAgreementId === agreement.agreementId} onClick={() => void selectAgreement(agreement)} disabled={busy !== null}>
          {selectedAgreementId === agreement.agreementId ? "الاتفاق المحدد" : "مراجعة النسب والقرار"}
        </button>
      </article>)}
    </section> : null}
    {nextCursor ? <button className="button button-secondary" type="button" onClick={() => void readQueue(nextCursor, true)} disabled={busy !== null}>{busy === "more" ? "جارٍ تحميل المزيد…" : "تحميل الاتفاقات التالية"}</button> : null}

    {selected ? <section className="access-card" aria-labelledby="selected-store-commercial-agreement-title">
      <p className="eyebrow">الاتفاق {selected.agreementId} · الإصدار {selected.agreementVersion}</p>
      <h3 id="selected-store-commercial-agreement-title">{selected.storeName || selected.storeId}</h3>
      <p className="muted">الحالة الحالية: {statusLabel(selected.status)} · رقم المتجر {selected.storeId}</p>
      <p className="muted">نوع المتجر: {selected.commercialStoreTypeId ?? "غير مربوط بنوع تجاري"} · مالك السجل الحالي: {selected.currentStoreOwnerActorId || "غير متاح"}</p>
      <p className="muted">مالك الاتفاق: {selected.partnerActorId} · أرسل الاتفاق {selected.proposedByActorId} في {formatTimestamp(selected.proposedAt)}</p>
      <p className="muted">قبول الشريك: {selected.partnerAcceptedByActorId ?? "غير مسجل"} · {formatTimestamp(selected.partnerAcceptedAt)}</p>
      <p className="muted">الإصدار الفعال: {selected.agreementVersion} · {selected.effectiveAt ? `ساري منذ ${formatTimestamp(selected.effectiveAt)}` : "لم يبدأ سريانه بعد"}</p>
      <p className="muted">أنماط تنفيذ المتجر: {selected.fulfillmentModes.map(modeLabel).join("، ") || "غير محددة"}</p>
      <h4>النسب الدقيقة في الاتفاق</h4>
      <ul>{selected.fulfillmentModes.map((mode) => {
        const rate = selected.rates.find((item) => item.fulfillmentMode === mode);
        return <li key={mode}>{modeLabel(mode)}: {rate ? `${formatPercent(rate.commissionRateBps)} (${rate.commissionRateBps} نقطة أساس)` : "لا توجد نسبة لهذا النمط"}</li>;
      })}</ul>
      {selected.reason ? <p className="muted">سبب اقتراح Field: {selected.reason}</p> : null}

      <h4>الافتراضات المرجعية من WLT</h4>
      {busy === "defaults" && defaultsTypeId ? <p role="status">جارٍ تحميل الافتراضات المرجعية…</p> : null}
      {!defaultsTypeId ? <p className="muted">لا يوجد نوع تجاري مربوط لعرض افتراضاته.</p> : null}
      {defaults && defaults.commercialStoreTypeId === defaultsTypeId ? <>
        <p className="muted">هذه قيم WLT المقترحة للنوع {defaults.commercialStoreTypeId} وإصداراتها، للمرجع فقط.</p>
        <ul>{storeCommercialAgreementModes.map(({ key, label }) => {
          const item = defaults.defaults.find((entry) => entry.fulfillmentMode === key);
          return <li key={key}>{label}: {item ? `${formatPercent(item.suggestedCommissionRateBps)} (${item.suggestedCommissionRateBps} نقطة أساس) · الإصدار ${item.defaultVersion}` : "لا توجد قيمة افتراضية"}</li>;
        })}</ul>
        {defaults.defaults.filter((item) => item.changedByActorId || item.changeReason).map((item) => <p className="muted" key={item.fulfillmentMode}>{modeLabel(item.fulfillmentMode)} · عدلها {item.changedByActorId || "غير معروف"}{item.changeReason ? ` · ${item.changeReason}` : ""}</p>)}
      </> : null}

      <label className="field-label" htmlFor="store-commercial-agreement-decision-reason">سبب القرار (إلزامي، 8 إلى 500 حرف)<textarea id="store-commercial-agreement-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} rows={3} disabled={busy !== null || Boolean(pendingAttempt)} placeholder="وضح مبرر اعتماد الاتفاق أو رفضه" /></label>
      {selected.status !== "PARTNER_ACCEPTED" || selected.partnerAcceptedByActorId !== selected.partnerActorId || selected.currentStoreOwnerActorId !== selected.partnerActorId || !selected.matchesCurrentFulfillmentModes ? <p className="validation-error" role="alert">لا يمكن اتخاذ القرار: يلزم اتفاق مقبول من المالك الحالي وبنسب مطابقة لأنماط المتجر الحالية.</p> : null}
      {pendingAttempt ? <p className="muted">توجد محاولة محفوظة؛ أكمل إعادة إرسالها أو تحقق من قراءتها قبل بدء قرار آخر.</p> : null}
      <div className="finance-toolbar">
        <button className="button button-primary" type="button" onClick={() => beginDecision("APPROVE")} disabled={!pendingStorageReady || Boolean(pendingStorageError) || busy !== null || Boolean(pendingAttempt) || selected.status !== "PARTNER_ACCEPTED" || selected.partnerAcceptedByActorId !== selected.partnerActorId || selected.currentStoreOwnerActorId !== selected.partnerActorId || !selected.matchesCurrentFulfillmentModes || Array.from(reason.trim()).length < 8}>{busy === "APPROVE" ? "جارٍ الاعتماد…" : "اعتماد الاتفاق"}</button>
        <button className="button button-secondary" type="button" onClick={() => beginDecision("REJECT")} disabled={!pendingStorageReady || Boolean(pendingStorageError) || busy !== null || Boolean(pendingAttempt) || selected.status !== "PARTNER_ACCEPTED" || selected.partnerAcceptedByActorId !== selected.partnerActorId || selected.currentStoreOwnerActorId !== selected.partnerActorId || !selected.matchesCurrentFulfillmentModes || Array.from(reason.trim()).length < 8}>{busy === "REJECT" ? "جارٍ الرفض…" : "رفض الاتفاق"}</button>
      </div>
    </section> : null}

    {verifiedDecision ? <article className="access-card" aria-live="polite">
      <p className="eyebrow">تم التحقق من نتيجة القرار عبر قراءة DSH</p>
      <h3>{verifiedDecision.attempt.storeName || verifiedDecision.agreement.storeId}</h3>
      <p className="muted">المتجر {verifiedDecision.agreement.storeId} · الاتفاق {verifiedDecision.agreement.agreementId} · الإصدار {verifiedDecision.agreement.agreementVersion} · الحالة {statusLabel(verifiedDecision.agreement.status)}</p>
      <p className="muted">قرار Finance: {verifiedDecision.attempt.decision} · الموظف {verifiedDecision.agreement.financeDecisionByActorId} · {formatTimestamp(verifiedDecision.agreement.financeDecisionAt)}</p>
      <p className="muted">سبب القرار المسجل: {verifiedDecision.agreement.financeDecisionReason}</p>
      {verifiedDecision.agreement.effectiveAt ? <p className="muted">ساري منذ {formatTimestamp(verifiedDecision.agreement.effectiveAt)}</p> : null}
    </article> : null}
    {error ? <p className="validation-error" role="alert">{error}</p> : null}
    {message ? <output className="success">{message}</output> : null}
  </section>;
}
