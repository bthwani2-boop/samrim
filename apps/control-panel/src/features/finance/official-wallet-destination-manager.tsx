"use client";

import type { OfficialWalletDestination } from "@bthwani/dsh";
import { useState } from "react";

type BeneficiaryActorType = "partner" | "captain" | "field";
type WalletIntent = Readonly<{ actorType: BeneficiaryActorType; actorId: string; providerKey: string; sourceId: string }>;
type DestinationResponse = Readonly<{ destination: OfficialWalletDestination; idempotentReplay?: boolean }>;
type IntentResponse = Readonly<{ intent: WalletIntent; operatorActorId: string }>;
type DestinationAction = "create" | "verify" | "activate";
type DestinationAttempt = Readonly<{
  action: DestinationAction;
  actorType: BeneficiaryActorType;
  actorId: string;
  operatorActorId: string;
  providerKey: string;
  idempotencyKey: string;
  correlationId: string;
  destinationId?: string;
  changeReason?: string;
  verificationEvidenceReference?: string;
  changeEvidenceReference?: string;
  evidenceReference?: string;
}>;

const destinationStatusLabels: Readonly<Record<OfficialWalletDestination["status"], string>> = {
  CANDIDATE: "مرشحة للتحقق المستقل",
  PENDING_APPROVAL: "تم التحقق؛ بانتظار اعتماد مستقل",
  ACTIVE_FOR_PAYOUT: "نشطة للصرف",
  SUSPENDED: "موقوفة",
  RETIRED: "مستبدلة",
};

const verificationStatusLabels: Readonly<Record<OfficialWalletDestination["verificationStatus"], string>> = {
  PENDING_VERIFICATION: "لم يكتمل التحقق",
  VERIFIED: "تم التحقق",
  REJECTED: "مرفوضة",
  STALE: "تحتاج إعادة التحقق",
};

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const nested = (body as { error?: { message?: unknown } }).error;
  return typeof nested?.message === "string" ? nested.message : fallback;
}

function isDestination(value: unknown): value is OfficialWalletDestination {
  if (!value || typeof value !== "object") return false;
  const destination = value as Partial<OfficialWalletDestination>;
  return typeof destination.id === "string" && typeof destination.actorId === "string" && typeof destination.actorType === "string" && typeof destination.providerKey === "string" && typeof destination.walletIdentifierMasked === "string" && typeof destination.verificationStatus === "string" && typeof destination.status === "string";
}

function storageKey(operatorActorId: string, actorType: BeneficiaryActorType, actorId: string) {
  return `finance-official-wallet-destination:${operatorActorId}:${actorType}:${actorId}`;
}

function expectedReadback(attempt: DestinationAttempt, destination: OfficialWalletDestination | null): boolean {
  if (!destination || destination.actorType !== attempt.actorType || destination.actorId !== attempt.actorId || destination.providerKey !== attempt.providerKey || (attempt.destinationId && destination.id !== attempt.destinationId)) return false;
  if (attempt.action === "create") {
    return destination.status === "CANDIDATE" && destination.verificationStatus === "PENDING_VERIFICATION" && destination.submittedBy === attempt.operatorActorId && destination.changeReason === attempt.changeReason && destination.verificationEvidenceReference === attempt.verificationEvidenceReference && destination.changeEvidenceReference === attempt.changeEvidenceReference;
  }
  if (attempt.action === "verify") {
    return destination.verificationStatus === "VERIFIED" && destination.status === "PENDING_APPROVAL" && destination.verifiedBy === attempt.operatorActorId && Boolean(destination.verifiedAt) && destination.verificationEvidenceReference === attempt.evidenceReference;
  }
  return destination.status === "ACTIVE_FOR_PAYOUT" && destination.verificationStatus === "VERIFIED" && destination.approvedBy === attempt.operatorActorId && Boolean(destination.approvedAt);
}

export function OfficialWalletDestinationManager({ actorType, actorId }: Readonly<{ actorType: BeneficiaryActorType; actorId: string }>) {
  const [intent, setIntent] = useState<WalletIntent | null>(null);
  const [operatorActorId, setOperatorActorId] = useState("");
  const [destination, setDestination] = useState<OfficialWalletDestination | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<DestinationAttempt | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [verificationEvidenceReference, setVerificationEvidenceReference] = useState("");
  const [changeEvidenceReference, setChangeEvidenceReference] = useState("");
  const [independentEvidenceReference, setIndependentEvidenceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function readCanonical(): Promise<Readonly<{ intent: WalletIntent; operatorActorId: string; destination: OfficialWalletDestination | null }>> {
    const query = `actorType=${encodeURIComponent(actorType)}&actorId=${encodeURIComponent(actorId)}`;
    const intentResponse = await fetch(`/api/finance/actor-destination/intent?${query}`, { cache: "no-store" });
    const intentPayload = await intentResponse.json().catch(() => null) as IntentResponse | null;
    if (!intentResponse.ok || !intentPayload?.intent || typeof intentPayload.operatorActorId !== "string" || intentPayload.intent.actorType !== actorType || intentPayload.intent.actorId !== actorId || !intentPayload.intent.providerKey.trim()) throw new Error(errorMessage(intentPayload, "تعذر قراءة اختيار مزوّد المحفظة من سجل الانضمام."));
    const destinationResponse = await fetch(`/api/finance/actor-destination?${query}`, { cache: "no-store" });
    let nextDestination: OfficialWalletDestination | null = null;
    if (destinationResponse.status !== 404) {
      const destinationPayload = await destinationResponse.json().catch(() => null) as DestinationResponse | null;
      if (!destinationResponse.ok || !isDestination(destinationPayload?.destination)) throw new Error(errorMessage(destinationPayload, "تعذرت قراءة الوجهة الحالية من WLT."));
      nextDestination = destinationPayload.destination;
      if (nextDestination.actorType !== actorType || nextDestination.actorId !== actorId) throw new Error("قراءة الوجهة لا تطابق المستفيد المحدد.");
    }
    setIntent(intentPayload.intent);
    setOperatorActorId(intentPayload.operatorActorId);
    setDestination(nextDestination);
    const key = storageKey(intentPayload.operatorActorId, actorType, actorId);
    const rawAttempt = window.sessionStorage.getItem(key);
    let savedAttempt: DestinationAttempt | null = null;
    if (rawAttempt) {
      try {
        const candidate = JSON.parse(rawAttempt) as DestinationAttempt;
        if (candidate.actorType === actorType && candidate.actorId === actorId && candidate.operatorActorId === intentPayload.operatorActorId && typeof candidate.idempotencyKey === "string" && typeof candidate.correlationId === "string") savedAttempt = candidate;
      } catch {
        window.sessionStorage.removeItem(key);
      }
    }
    if (savedAttempt && expectedReadback(savedAttempt, nextDestination)) {
      window.sessionStorage.removeItem(key);
      setPendingAttempt(null);
      setNotice("أكدت قراءة WLT النتيجة والحالة والوجهة المتوقعة.");
    } else {
      setPendingAttempt(savedAttempt);
      setNotice(savedAttempt ? "توجد محاولة محفوظة. راجع قراءة WLT ثم أعد إرسال المحاولة نفسها عند الحاجة." : "قُرئت نية المزوّد والوجهة الحالية من السجلين الكانونيين.");
    }
    return { intent: intentPayload.intent, operatorActorId: intentPayload.operatorActorId, destination: nextDestination };
  }

  async function read() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await readCanonical();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الوجهة.");
    } finally {
      setBusy(false);
    }
  }

  function persistAttempt(attempt: DestinationAttempt) {
    window.sessionStorage.setItem(storageKey(attempt.operatorActorId, actorType, actorId), JSON.stringify(attempt));
    setPendingAttempt(attempt);
  }

  async function runAttempt(existingAttempt?: DestinationAttempt, actionOverride?: DestinationAction) {
    if (busy || !intent || !operatorActorId) return;
    let attempt: DestinationAttempt;
    if (existingAttempt) {
      attempt = existingAttempt;
    } else if (actionOverride === "verify" || (destination?.verificationStatus === "STALE" && destination.status === "SUSPENDED")) {
      if (!destination) {
        setError("أعد قراءة سجل WLT قبل إعادة التحقق من الوجهة.");
        return;
      }
      attempt = { action: "verify", actorType, actorId, operatorActorId, providerKey: intent.providerKey, destinationId: destination.id, evidenceReference: independentEvidenceReference.trim(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    } else if (actionOverride === "activate") {
      if (!destination) {
        setError("أعد قراءة سجل WLT قبل اعتماد الوجهة.");
        return;
      }
      attempt = { action: "activate", actorType, actorId, operatorActorId, providerKey: intent.providerKey, destinationId: destination.id, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    } else if (actionOverride === "create" || !destination || destination.status === "ACTIVE_FOR_PAYOUT" || destination.status === "RETIRED" || destination.status === "SUSPENDED") {
      attempt = { action: "create", actorType, actorId, operatorActorId, providerKey: intent.providerKey, changeReason: changeReason.trim(), verificationEvidenceReference: verificationEvidenceReference.trim(), changeEvidenceReference: changeEvidenceReference.trim(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    } else if (destination.verificationStatus === "VERIFIED") {
      attempt = { action: "activate", actorType, actorId, operatorActorId, providerKey: intent.providerKey, destinationId: destination.id, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    } else {
      attempt = { action: "verify", actorType, actorId, operatorActorId, providerKey: intent.providerKey, destinationId: destination.id, evidenceReference: independentEvidenceReference.trim(), idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    }
    const boundAttempt = { ...attempt, providerKey: "providerKey" in attempt ? attempt.providerKey : intent.providerKey };
    if (boundAttempt.action === "create" && (!boundAttempt.changeReason?.trim() || !boundAttempt.verificationEvidenceReference?.trim() || !boundAttempt.changeEvidenceReference?.trim())) {
      setError("أدخل سبب تغيير الوجهة ومرجعي دليل التغيير والتحقق.");
      return;
    }
    if (boundAttempt.action === "verify" && !boundAttempt.evidenceReference?.trim()) {
      setError("أدخل مرجع دليل التحقق المستقل.");
      return;
    }
    if (boundAttempt.action === "verify" && destination?.submittedBy === operatorActorId) {
      setError("يجب أن ينفذ التحقق موظف Finance آخر غير منشئ الوجهة.");
      return;
    }
    if (boundAttempt.action === "activate" && destination?.verifiedBy === operatorActorId) {
      setError("يجب أن يعتمد الوجهة موظف Finance آخر غير من نفذ التحقق.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      persistAttempt(boundAttempt);
      const query = `actorType=${encodeURIComponent(actorType)}&actorId=${encodeURIComponent(actorId)}${boundAttempt.destinationId ? `&destinationId=${encodeURIComponent(boundAttempt.destinationId)}` : ""}`;
      const path = boundAttempt.action === "create" ? `/api/finance/actor-destination?${query}` : boundAttempt.action === "verify" ? `/api/finance/actor-destination/verify?${query}` : `/api/finance/actor-destination/activate?${query}`;
      const body = boundAttempt.action === "create"
        ? { changeReason: boundAttempt.changeReason, verificationEvidenceReference: boundAttempt.verificationEvidenceReference, changeEvidenceReference: boundAttempt.changeEvidenceReference }
        : boundAttempt.action === "verify" ? { evidenceReference: boundAttempt.evidenceReference } : {};
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as DestinationResponse | null;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          window.sessionStorage.removeItem(storageKey(operatorActorId, actorType, actorId));
          setPendingAttempt(null);
        }
        throw new Error(errorMessage(payload, "تعذر تنفيذ الإجراء على الوجهة في WLT."));
      }
      if (!isDestination(payload?.destination) || payload.destination.actorType !== actorType || payload.destination.actorId !== actorId || payload.destination.providerKey !== intent.providerKey || (boundAttempt.destinationId && payload.destination.id !== boundAttempt.destinationId)) throw new Error("استجابة WLT لا تطابق المستفيد أو مزوّد المحفظة أو الوجهة المحددة.");
      const confirmedAttempt = { ...boundAttempt, destinationId: payload.destination.id };
      persistAttempt(confirmedAttempt);
      const canonical = await readCanonical();
      const verifiedIntent = intentPayloadIsCurrent(canonical.intent, actorType, actorId);
      if (!verifiedIntent) throw new Error("لم تتطابق قراءة نية المزوّد بعد الإجراء.");
      const key = storageKey(operatorActorId, actorType, actorId);
      if (canonical.operatorActorId === operatorActorId && expectedReadback(confirmedAttempt, canonical.destination)) {
        window.sessionStorage.removeItem(key);
        setPendingAttempt(null);
        setNotice("نجح الإجراء وتأكدت قراءة WLT المطابقة.");
      } else {
        setPendingAttempt(confirmedAttempt);
        setError("وصل رد الإجراء، لكن قراءة WLT لم تثبت الحالة المتوقعة. استخدم إعادة المحاولة للمفتاح نفسه أو أعد قراءة السجل.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تأكيد نتيجة الإجراء.");
    } finally {
      setBusy(false);
    }
  }

  const legacyStaleDestination = destination?.status === "SUSPENDED" && destination.verificationStatus === "STALE";
  const createAllowed = !destination || destination.status === "ACTIVE_FOR_PAYOUT" || destination.status === "RETIRED" || (destination.status === "SUSPENDED" && !legacyStaleDestination);
  const nextAction: DestinationAction | null = legacyStaleDestination ? "verify" : !destination || createAllowed ? "create" : destination.verificationStatus === "VERIFIED" ? "activate" : "verify";
  const nextActionLabel = nextAction === "create" ? "إنشاء مرشح من هوية ومزوّد مسجلين" : nextAction === "verify" ? legacyStaleDestination ? "إعادة التحقق من الوجهة نفسها" : "تحقق مستقل من الوجهة" : "اعتماد مستقل وتفعيل الوجهة";

  return <details className="settlement-resource">
    <summary className="button button-quiet">إدارة وجهة المحفظة الرسمية</summary>
    <div className="space-y-3 pt-3">
      <p className="muted">تأتي هوية المستفيد ورقم المحفظة من Identity الموثق، ويأتي المزوّد من اختيار المستفيد عند الانضمام. أدخل مراجع الأدلة فقط؛ لا تدخل رقم المحفظة أو الاسم.</p>
      <button className="button button-secondary" type="button" onClick={() => void read()} disabled={busy}>{busy ? "جارٍ القراءة…" : "قراءة النية والوجهة من DSH وWLT"}</button>
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      {notice ? <p className="managed-status managed-status-info" role="status">{notice}</p> : null}
      {intent ? <p>المزوّد المسجل: <bdi>{intent.providerKey}</bdi> · مصدره: <bdi>{intent.sourceId}</bdi></p> : <p className="muted">اقرأ السجل قبل تنفيذ أي إجراء.</p>}
      {destination ? <div className="managed-status managed-status-info"><strong>{destinationStatusLabels[destination.status]}</strong><p>{verificationStatusLabels[destination.verificationStatus]} · <bdi>{destination.providerKey}</bdi> · <bdi>{destination.walletIdentifierMasked}</bdi></p><p>{destination.beneficiaryName}</p><small>الوجهة <bdi>{destination.id}</bdi> · الإصدار {destination.version} · هوية {destination.beneficiaryIdentityVersion}</small></div> : intent ? <p className="muted">لا توجد وجهة WLT مسجلة لهذا المستفيد.</p> : null}
      {legacyStaleDestination ? <p className="managed-status managed-status-warning">يمكن استعادة اللقطات المالية القديمة فقط إذا طابقت الوجهة الحالية رقم المحفظة والاسم المحفوظين فيها. تغيير الهوية أو الرقم يتطلب إنشاء وجهة جديدة، ولا يغيّر الوجهة المحفوظة في أي لقطة معتمدة.</p> : null}
      {pendingAttempt ? <div className="managed-status managed-status-warning"><p>محاولة محفوظة للإجراء «{pendingAttempt.action}» بالمفتاح نفسه؛ لم تُرسل تلقائيًا بعد إعادة التحميل.</p><button className="button button-primary" type="button" onClick={() => void runAttempt(pendingAttempt)} disabled={busy}>{busy ? "جارٍ إعادة المحاولة…" : "إعادة إرسال المحاولة المحفوظة"}</button></div> : null}
      {!pendingAttempt && intent && nextAction === "create" ? <div className="space-y-2"><label className="field-label">سبب إنشاء أو تغيير الوجهة<input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={512} disabled={busy} /></label><label className="field-label">مرجع دليل التحقق المتوقع<input value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} maxLength={512} disabled={busy} /></label><label className="field-label">مرجع دليل طلب تغيير الوجهة<input value={changeEvidenceReference} onChange={(event) => setChangeEvidenceReference(event.target.value)} maxLength={512} disabled={busy} /></label><button className="button button-primary" type="button" onClick={() => void runAttempt()} disabled={busy}>{nextActionLabel}</button></div> : null}
      {!pendingAttempt && intent && nextAction === "verify" ? <div className="space-y-2"><label className="field-label">مرجع دليل التحقق المستقل<input value={independentEvidenceReference} onChange={(event) => setIndependentEvidenceReference(event.target.value)} maxLength={512} disabled={busy} /></label><button className="button button-primary" type="button" onClick={() => void runAttempt()} disabled={busy || destination?.submittedBy === operatorActorId}>{destination?.submittedBy === operatorActorId ? "يتطلب تحقق موظف Finance آخر" : nextActionLabel}</button></div> : null}
      {!pendingAttempt && intent && legacyStaleDestination ? <div className="space-y-2"><label className="field-label">مرجع دليل التحقق للوجهة البديلة<input value={verificationEvidenceReference} onChange={(event) => setVerificationEvidenceReference(event.target.value)} maxLength={512} disabled={busy} /></label><label className="field-label">سبب إنشاء الوجهة البديلة<input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={512} disabled={busy} /></label><label className="field-label">مرجع دليل طلب تغيير الوجهة<input value={changeEvidenceReference} onChange={(event) => setChangeEvidenceReference(event.target.value)} maxLength={512} disabled={busy} /></label><button className="button button-secondary" type="button" onClick={() => void runAttempt(undefined, "create")} disabled={busy || !changeReason.trim() || !verificationEvidenceReference.trim() || !changeEvidenceReference.trim()}>إنشاء وجهة بديلة بعد تغير رقم الهوية</button></div> : null}
      {!pendingAttempt && intent && nextAction === "activate" ? <button className="button button-primary" type="button" onClick={() => void runAttempt()} disabled={busy || destination?.verifiedBy === operatorActorId}>{destination?.verifiedBy === operatorActorId ? "يتطلب اعتماد موظف Finance آخر" : nextActionLabel}</button> : null}
    </div>
  </details>;
}

function intentPayloadIsCurrent(intent: WalletIntent, actorType: BeneficiaryActorType, actorId: string) {
  return intent.actorType === actorType && intent.actorId === actorId && intent.providerKey.trim().length > 0;
}
