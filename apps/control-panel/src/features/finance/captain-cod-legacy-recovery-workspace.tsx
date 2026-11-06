"use client";

import { formatMoney, type LegacyCODRecoveryResponse } from "@bthwani/dsh";
import { type FormEvent, useRef, useState } from "react";
import { responseMessage } from "../access/identity-error-message";
import { useSession } from "../../session/session-provider";
import { operatorPaymentRecoveryStorageKey, operatorRecoveryStorageKey } from "./operator-recovery-key";

type Review = LegacyCODRecoveryResponse["review"];
type Props = Readonly<{ initialPaymentId?: string }>;
type Pending = Readonly<{
  paymentIntentId: string;
  fingerprint: string;
  documentId: string;
  uploadKey: string;
  uploadCorrelation: string;
  submitKey: string;
  submitCorrelation: string;
  approveKey: string;
  approveCorrelation: string;
}>;

const recoveryBaseKey = "bthwani.finance.legacy-cod-review.v1";

function readPending(actorId: string, paymentIntentId: string): Pending | null {
  try {
    const key = operatorPaymentRecoveryStorageKey(recoveryBaseKey, actorId, paymentIntentId);
    if (!key) return null;
    const legacyKey = operatorRecoveryStorageKey(recoveryBaseKey, actorId);
    // Preserve an in-flight pre-fix attempt until it is next saved or closed.
    const raw = window.sessionStorage.getItem(key) ?? (legacyKey ? window.sessionStorage.getItem(legacyKey) : null);
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (item.paymentIntentId !== paymentIntentId || !paymentIntentId) return null;
    for (const field of ["uploadKey", "uploadCorrelation", "submitKey", "submitCorrelation", "approveKey", "approveCorrelation"]) {
      if (typeof item[field] !== "string" || item[field].length < 8 || item[field].length > 128) return null;
    }
    if (typeof item.fingerprint !== "string" || typeof item.documentId !== "string" || item.documentId.length > 128) return null;
    return item as Pending;
  } catch {
    return null;
  }
}

function savePending(actorId: string, paymentIntentId: string, pending: Pending | null) {
  try {
    const key = operatorPaymentRecoveryStorageKey(recoveryBaseKey, actorId, paymentIntentId);
    if (!key) return;
    if (pending) window.sessionStorage.setItem(key, JSON.stringify(pending));
    else window.sessionStorage.removeItem(key);
    const legacyKey = operatorRecoveryStorageKey(recoveryBaseKey, actorId);
    const legacyRaw = legacyKey ? window.sessionStorage.getItem(legacyKey) : null;
    if (legacyKey && legacyRaw && (JSON.parse(legacyRaw) as Pending).paymentIntentId === paymentIntentId) {
      window.sessionStorage.removeItem(legacyKey);
    }
  } catch {
    // A storage failure must not be treated as evidence of a completed operation.
  }
}

function newPending(paymentIntentId: string, fingerprint: string): Pending {
  return {
    paymentIntentId, fingerprint, documentId: "",
    uploadKey: crypto.randomUUID(), uploadCorrelation: crypto.randomUUID(),
    submitKey: crypto.randomUUID(), submitCorrelation: crypto.randomUUID(),
    approveKey: crypto.randomUUID(), approveCorrelation: crypto.randomUUID(),
  };
}

export function CaptainCODLegacyRecoveryWorkspace({ initialPaymentId = "" }: Props) {
  const { state: session } = useSession();
  const actorId = session.kind === "authenticated" ? session.identity.subject.trim() : "";
  const [paymentIntentId, setPaymentIntentId] = useState(initialPaymentId);
  const [searchedPaymentId, setSearchedPaymentId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [approvedConfirmed, setApprovedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const serial = useRef(0);
  const canonicalPaymentId = paymentIntentId.trim();
  const reviewed = review?.paymentIntentId === searchedPaymentId ? review : null;

  async function lookup(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const paymentId = canonicalPaymentId;
    if (!actorId || !paymentId || paymentId.length > 128 || busy) return;
    const requestId = ++serial.current;
    setBusy(true);
    setError("");
    setNotice("");
    setApprovedConfirmed(false);
    setReview(null);
    setSearchedPaymentId(paymentId);
    setDocumentId(readPending(actorId, paymentId)?.documentId ?? "");
    try {
      const response = await fetch(`/api/finance/captain-cod-legacy-reviews/by-payment/${encodeURIComponent(paymentId)}`, { cache: "no-store" });
      if (requestId !== serial.current) return;
      if (response.status === 404) {
        setNotice("لا توجد مراجعة مسجلة لهذا التحصيل. تقديم طلب جديد يتطلب مستندًا وإثبات تحصيل مؤهلًا في WLT.");
        return;
      }
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as LegacyCODRecoveryResponse;
      if (result.review?.paymentIntentId !== paymentId) throw new Error("هوية مراجعة التحصيل لا تطابق الطلب.");
      setReview(result.review);
      setDocumentId("");
      savePending(actorId, paymentId, null);
    } catch (cause) {
      if (requestId === serial.current) setError(cause instanceof Error ? cause.message : "تعذر قراءة مراجعة التحصيل.");
    } finally {
      if (requestId === serial.current) setBusy(false);
    }
  }

  async function submit() {
    const paymentId = canonicalPaymentId;
    if (!actorId || busy || reviewed || !paymentId || paymentId !== searchedPaymentId) return;
    const fingerprint = proof ? `${proof.name}:${proof.size}:${proof.lastModified}:${proof.type}` : "";
    let pending = readPending(actorId, paymentId);
    if (pending && proof && pending.fingerprint !== fingerprint) pending = null;
    if (!pending) pending = newPending(paymentId, fingerprint);
    if (!pending.documentId && !proof) {
      setError("أرفق مستند إثبات التحصيل الأصلي قبل تقديم المراجعة.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const requestId = ++serial.current;
    savePending(actorId, paymentId, pending);
    try {
      if (!pending.documentId) {
        const form = new FormData();
        form.set("purpose", "CAPTAIN_COD_LEGACY_RECOVERY");
        form.set("file", proof!, proof!.name);
        const uploaded = await fetch("/api/finance/evidence", {
          method: "POST",
          headers: { "Idempotency-Key": pending.uploadKey, "X-Correlation-ID": pending.uploadCorrelation },
          body: form,
        });
        if (!uploaded.ok) throw new Error(await responseMessage(uploaded));
        const body = await uploaded.json() as { document?: { id?: string } };
        if (!body.document?.id) throw new Error("تعذر تأكيد حفظ المستند. لا تُنشئ محاولة جديدة قبل مراجعة الطلب.");
        pending = { ...pending, documentId: body.document.id };
        savePending(actorId, paymentId, pending);
        // Another payment may have been selected while the upload was in flight.
        if (requestId === serial.current) setDocumentId(pending.documentId);
      }
      const response = await fetch("/api/finance/captain-cod-legacy-reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.submitKey,
          "X-Correlation-ID": pending.submitCorrelation,
        },
        body: JSON.stringify({ paymentIntentId: paymentId, evidenceDocumentId: pending.documentId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as LegacyCODRecoveryResponse;
      if (result.review?.paymentIntentId !== paymentId) throw new Error("تعذر تأكيد هوية مراجعة التحصيل.");
      if (requestId !== serial.current) return;
      setReview(result.review);
      setProof(null);
      setDocumentId("");
      savePending(actorId, paymentId, null);
      setNotice("حُفظ طلب المراجعة المالية. يلزم اعتماده من مشغّل مالية مختلف لديه الصلاحية.");
    } catch (cause) {
      if (requestId === serial.current) setError(cause instanceof Error ? cause.message : "تعذر حفظ المراجعة. اقرأ الحالة قبل إعادة المحاولة.");
    } finally {
      if (requestId === serial.current) setBusy(false);
    }
  }

  async function approve() {
    if (!actorId || busy || !approvedConfirmed || !reviewed || reviewed.status !== "PENDING" || reviewed.submittedBy === actorId) return;
    const paymentId = reviewed.paymentIntentId;
    const pending = readPending(actorId, paymentId) ?? newPending(paymentId, "");
    savePending(actorId, paymentId, pending);
    const requestId = ++serial.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/finance/captain-cod-legacy-reviews/${encodeURIComponent(reviewed.id)}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.approveKey,
          "X-Correlation-ID": pending.approveCorrelation,
        },
        body: "{}",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as LegacyCODRecoveryResponse;
      if (result.review?.id !== reviewed.id || result.review.status !== "APPROVED") throw new Error("تعذر تأكيد اعتماد المراجعة من WLT.");
      if (requestId !== serial.current) return;
      setReview(result.review);
      setApprovedConfirmed(false);
      savePending(actorId, paymentId, null);
      setNotice("اعتمد WLT المراجعة وأنشأ الحجز الممول للكابتن الأصلي. لم يتم تنفيذ خصم أو تسوية من هذه الشاشة.");
    } catch (cause) {
      if (requestId === serial.current) setError(cause instanceof Error ? cause.message : "الاعتماد غير مؤكد؛ اقرأ الحالة قبل إعادة المحاولة.");
    } finally {
      if (requestId === serial.current) setBusy(false);
    }
  }

  return (
    <details id="legacy-cod-review" className="access-card" open={Boolean(initialPaymentId)}>
      <summary>مراجعة تحصيل COD التاريخي بدون حجز مالي</summary>
      <p className="muted">هذا استثناء مالي لتحصيل سابق فقط، لا يُنشئ حجزًا إلا بعد التحقق من الإثبات والرصيد واعتماد مشغّل مالية ثانٍ. لا تُستخدم هذه الآلية للطلبات الجديدة.</p>
      <form className="form-section" onSubmit={(event) => void lookup(event)}>
        <label className="field-label" htmlFor="legacy-cod-payment">معرّف عملية الدفع
          <input id="legacy-cod-payment" value={paymentIntentId} maxLength={128} autoComplete="off" onChange={(event) => {
            ++serial.current;
            setBusy(false);
            setPaymentIntentId(event.target.value);
            setSearchedPaymentId("");
            setReview(null);
            setDocumentId("");
            setProof(null);
            setApprovedConfirmed(false);
            setError("");
            setNotice("");
          }} />
        </label>
        <button type="submit" className="button button-secondary" disabled={busy || !actorId || !canonicalPaymentId}>قراءة حالة المراجعة</button>
      </form>
      {error ? <p className="managed-status managed-status-warning" role="alert">{error}</p> : null}
      {notice ? <p className="managed-status managed-status-info" role="status">{notice}</p> : null}
      {reviewed ? <section className="form-section" aria-label="تفاصيل مراجعة التحصيل التاريخي">
        <p>الحالة: <strong>{reviewed.status === "PENDING" ? "بانتظار اعتماد المالية المستقل" : "معتمدة"}</strong></p>
        <p>الكابتن الأصلي: <bdi dir="ltr">{reviewed.captainActorId}</bdi> · المبلغ: <bdi dir="ltr">{formatMoney(reviewed.amountMinor, "YER")}</bdi></p>
        <p>مقدم الطلب: <bdi dir="ltr">{reviewed.submittedBy}</bdi></p>
        <p>مستند الإثبات: <a href={`/api/finance/evidence/${encodeURIComponent(reviewed.evidenceDocumentId)}`} target="_blank" rel="noopener noreferrer">عرض المستند المصرح</a></p>
        {reviewed.status === "PENDING" && reviewed.submittedBy !== actorId ? <>
          <label className="field-label"><input type="checkbox" checked={approvedConfirmed} onChange={(event) => setApprovedConfirmed(event.target.checked)} /> تحققت من سند التحصيل والكابتن الأصلي والمبلغ والرصيد، وأوافق على إنشاء الحجز المالي.</label>
          <button type="button" className="button button-secondary" onClick={() => void approve()} disabled={busy || !approvedConfirmed}>اعتماد مستقل بواسطة المالية</button>
        </> : null}
        {reviewed.status === "PENDING" && reviewed.submittedBy === actorId ? <p className="managed-status managed-status-warning">لا يمكن لمقدم الطلب اعتماده بنفسه. يلزم مشغّل مالية آخر.</p> : null}
        {reviewed.status === "APPROVED" ? <p className="managed-status managed-status-success">الحجز المالي المعتمد: <bdi dir="ltr">{reviewed.reservationId}</bdi> · تم الاعتماد بواسطة <bdi dir="ltr">{reviewed.approvedBy}</bdi></p> : null}
      </section> : searchedPaymentId && !review && !busy && !error ? <div className="form-section">
        <label className="field-label" htmlFor="legacy-cod-proof">إثبات التحصيل التاريخي (PDF أو صورة)
          <input id="legacy-cod-proof" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => {
            setProof(event.target.files?.[0] ?? null);
            setDocumentId("");
          }} />
        </label>
        {documentId ? <p className="muted">يوجد مستند محفوظ لمحاولة سابقة ويمكن استئنافها.</p> : null}
        <button type="button" className="button button-secondary" disabled={busy || !actorId || (!proof && !documentId)} onClick={() => void submit()}>رفع الإثبات وتقديم طلب المراجعة</button>
      </div> : null}
    </details>
  );
}
