"use client";

import { useState } from "react";

import { captainAdmissionStateLabel, captainAssignmentStateLabel, captainAvailabilityStateLabel, captainHandoffStateLabel, captainOfferStateLabel, type CaptainAdmission, type CaptainAssignment, type CaptainHandoff, type CaptainOffer } from "@bthwani/dsh";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type CaptainOperationResult = Readonly<{
  operation: "admit" | "dispatch" | "reassign" | "recover";
  idempotentReplay: boolean;
  admission?: Readonly<{ id: string; actorId: string; state: CaptainAdmission["state"]; availabilityState: CaptainAdmission["availabilityState"]; version: number }>;
  offer?: Readonly<{ id: string; orderId: string; captainActorId: string; state: CaptainOffer["state"]; expiresAt: string; version: number }>;
  assignment?: Readonly<{ id: string; orderId: string; state: CaptainAssignment["state"]; handoffState?: CaptainHandoff["state"]; version: number }>;
}>;

export function CaptainDispatchPanel() {
  const [phone, setPhone] = useState("");
  const [orderId, setOrderId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [assignmentVersion, setAssignmentVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<CaptainOperationResult | null>(null);
  const [error, setError] = useState("");

  async function run(action: "admit" | "dispatch" | "reassign" | "recover") {
    const expectedVersion = action === "recover" ? assignmentVersion : null;
    if (action === "recover" && expectedVersion === null) {
      setError("اقرأ التكليف من عملية التوزيع أو إعادة التعيين قبل استعادة فشل التسليم.");
      return;
    }
    setBusy(action); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/captains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone, orderId, assignmentId, ...(expectedVersion === null ? {} : { expectedVersion }) }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const next = await response.json() as CaptainOperationResult;
      setResult(next);
      if (next.assignment) {
        setAssignmentVersion(next.assignment.version);
        setAssignmentId(next.assignment.id);
      }
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى خدمة التشغيل.");
    } finally { setBusy(""); }
  }

  return <section className="access-card" aria-labelledby="captain-dispatch-title"><div className="access-card-heading"><span className="step-chip">التشغيل · التوزيع</span><p className="eyebrow">القبول والتوزيع</p><h2 id="captain-dispatch-title">تشغيل مسار الكابتن</h2><p className="muted">القبول والتوزيع يقرآن النتيجة من خدمة التشغيل بعد كل عملية. لا نطلب من المشغل إدخال نسخة داخلية؛ الاستعادة تستخدم آخر قراءة مؤكدة للتكليف.</p></div><div className="access-form"><label className="field-label" htmlFor="captain-phone">هاتف الكابتن المراد قبوله<input id="captain-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" className="button button-primary" disabled={Boolean(busy) || !phone.trim()} onClick={() => void run("admit")}>{busy === "admit" ? "جارٍ القبول…" : "قبول الكابتن"}</button><label className="field-label" htmlFor="captain-order">مرجع الطلب للتوزيع<input id="captain-order" placeholder="مرجع الطلب" value={orderId} onChange={(event) => setOrderId(event.target.value)} /></label><div className="managed-status-actions"><button type="button" className="button button-primary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("dispatch")}>{busy === "dispatch" ? "جارٍ التوزيع…" : "إرسال عرض"}</button><button type="button" className="button button-secondary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("reassign")}>{busy === "reassign" ? "جارٍ إعادة التعيين…" : "إعادة التعيين"}</button></div><label className="field-label" htmlFor="captain-assignment">مرجع التكليف لاستعادة فشل التسليم<input id="captain-assignment" placeholder="مرجع التكليف" value={assignmentId} onChange={(event) => { setAssignmentId(event.target.value); setAssignmentVersion(null); }} /></label>{assignmentVersion !== null ? <p className="field-help" role="status">تمت قراءة حالة التكليف من خدمة التشغيل، وستُستخدم القراءة المعتمدة تلقائيًا عند الاستعادة.</p> : <p className="field-help">نفّذ التوزيع أو إعادة التعيين أولًا لقراءة حالة التكليف المعتمدة.</p>}<button type="button" className="button button-secondary" disabled={Boolean(busy) || !assignmentId.trim() || assignmentVersion === null} onClick={() => void run("recover")}>{busy === "recover" ? "جارٍ الاستعادة…" : "استعادة فشل التسليم"}</button></div>{result ? <div className="code-output" role="status"><p>{result.operation === "admit" ? "تم قبول الكابتن" : result.operation === "dispatch" ? "تمت قراءة عرض التوزيع" : result.operation === "reassign" ? "تمت قراءة إعادة التعيين" : "تمت قراءة نتيجة الاستعادة"} · {result.idempotentReplay ? "إعادة قراءة آمنة" : "تم الحفظ"}</p>{result.admission ? <p>حالة القبول: {captainAdmissionStateLabel(result.admission.state)} · التوفر: {captainAvailabilityStateLabel(result.admission.availabilityState)}</p> : null}{result.offer ? <p>حالة العرض: {captainOfferStateLabel(result.offer.state)} · ينتهي {new Date(result.offer.expiresAt).toLocaleString("ar-YE")}</p> : null}{result.assignment ? <p>حالة التكليف: {captainAssignmentStateLabel(result.assignment.state)} · تسليم المتجر: {result.assignment.handoffState ? captainHandoffStateLabel(result.assignment.handoffState) : "غير متاح"}</p> : null}</div> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}</section>;
}
