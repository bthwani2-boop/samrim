"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Decision = "CONFIRMED" | "NO_ANSWER" | "DENIED" | "WRONG_NUMBER";
type Review = Readonly<{
  orderId: string;
  state: "PENDING" | Decision;
  attemptCount: number;
  version: number;
  lastAttemptAt?: string;
  confirmedAt?: string;
  verifiedSuccessfulOrders: number;
  legacyExempt: boolean;
  trusted: boolean;
  needsContact: boolean;
}>;
const decisions: ReadonlyArray<Readonly<{ value: Decision; label: string }>> = [
  { value: "CONFIRMED", label: "تواصلت مع العميل وأكد الطلب" },
  { value: "NO_ANSWER", label: "لم يرد العميل" },
  { value: "DENIED", label: "العميل لا يعرف الطلب" },
  { value: "WRONG_NUMBER", label: "رقم التواصل غير صحيح" },
];

export function CustomerContactReviewPanel({ orderId, onUpdated }: Readonly<{ orderId: string; onUpdated?: (() => void) | undefined }>) {
  const [review, setReview] = useState<Review | null>(null);
  const [decision, setDecision] = useState<Decision>("CONFIRMED");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const attemptKey = useRef("");

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(orderId)}/contact-review`,
        { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("تعذر قراءة إثبات التواصل من الخدمة.");
      const result = await response.json() as { review?: Review };
      if (!result.review || result.review.orderId !== orderId
        || !Number.isInteger(result.review.version) || !Number.isInteger(result.review.verifiedSuccessfulOrders)) {
        throw new Error("نتيجة التحقق غير صالحة.");
      }
      if (current === sequence.current) { setReview(result.review); setError(""); }
    } catch (reason) {
      if (current === sequence.current) { setReview(null); setError(reason instanceof Error ? reason.message : "تعذرت القراءة."); }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [orderId]);
  useEffect(() => {
    setReview(null);
    setError("");
    setNotice("");
    attemptKey.current = "";
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  async function recordContact() {
    if (!review?.needsContact || busy || inFlight.current || loading) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    // Keep this key after an ambiguous network failure so retry cannot create
    // a second contact event. The next read may reveal the committed decision.
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(orderId)}/contact-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey.current },
        body: JSON.stringify({ decision, expectedVersion: review.version }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        await reload();
        if (response.status === 409) attemptKey.current = "";
        throw new Error(response.status === 409 ? "تغيرت نتيجة التواصل؛ راجع الحالة الحالية." : "تعذر التأكد من نتيجة الاتصال. أعد قراءة الحالة قبل إعادة الإجراء.");
      }
      const body = await response.json() as { review?: Review };
      if (!body.review || body.review.orderId !== orderId) throw new Error("نتيجة العملية غير مؤكدة. أعد القراءة.");
      setReview(body.review);
      attemptKey.current = "";
      setNotice(decision === "CONFIRMED" ? "سُجّل تأكيد العميل. لا تُحتسب خطوة الثقة إلا بعد اكتمال الطلب." : "سُجلت نتيجة محاولة التواصل.");
      onUpdated?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "نتيجة الاتصال غير مؤكدة؛ أعد القراءة.");
      await reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="order-detail-panel" aria-label="التحقق من العميل الجديد">
    <h2>التحقق من العميل</h2>
    {loading ? <p className="muted" role="status">جارٍ قراءة سجل التواصل…</p> : null}
    {review ? <>
      <p className="muted">{review.trusted
        ? review.legacyExempt ? "عميل قديم معفى بناءً على سجل الطلبات السابقة." : "عميل موثوق، لا يحتاج إلى اتصال روتيني."
        : `طلبات ناجحة مع اتصال مؤكد: ${review.verifiedSuccessfulOrders} من 3. لا تحتسب المكالمة وحدها نجاحًا.`}</p>
      {!review.trusted && review.state === "CONFIRMED" ? <p role="status">جرى تأكيد هذا الطلب. تُحتسب خطوة الثقة عند اكتماله رسميًا.</p> : null}
      {review.needsContact ? <div className="order-detail-state-actions">
        <label htmlFor="ops-contact-decision">نتيجة الاتصال الفعلي</label>
        <select id="ops-contact-decision" value={decision} onChange={(event) => { setDecision(event.target.value as Decision); attemptKey.current = ""; }} disabled={busy}>
          {decisions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button type="button" className="button button-secondary" onClick={() => void recordContact()} disabled={busy || loading}>
          {busy ? "جارٍ توثيق الاتصال…" : "حفظ نتيجة التواصل"}
        </button>
      </div> : null}
      {review.attemptCount > 0 ? <p className="muted">محاولات موثقة لهذا الطلب: {review.attemptCount}</p> : null}
    </> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <div role="alert" className="managed-status managed-status-warning">
      <p>{error}</p>
      <button type="button" className="button button-secondary" onClick={() => void reload()} disabled={busy || loading}>إعادة قراءة الحالة</button>
    </div> : null}
  </section>;
}
