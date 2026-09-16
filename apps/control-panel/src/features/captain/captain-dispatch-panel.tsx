"use client";

import { useState } from "react";

import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type CaptainOperationResult = Readonly<{
  operation: string;
  idempotentReplay: boolean;
  admission?: Readonly<{ id: string; actorId: string; state: string; availabilityState: string; version: number }>;
  offer?: Readonly<{ id: string; orderId: string; captainActorId: string; state: string; expiresAt: string; version: number }>;
  assignment?: Readonly<{ id: string; orderId: string; state: string; handoffState?: string; version: number }>;
}>;

export function CaptainDispatchPanel() {
  const [phone, setPhone] = useState("");
  const [orderId, setOrderId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [expectedVersion, setExpectedVersion] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<CaptainOperationResult | null>(null);
  const [error, setError] = useState("");

  async function run(action: "admit" | "dispatch" | "reassign" | "recover") {
    setBusy(action); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/captains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone, orderId, assignmentId, expectedVersion: expectedVersion.trim() ? Number(expectedVersion) : undefined }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      setResult(await response.json() as CaptainOperationResult);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى DSH.");
    } finally { setBusy(""); }
  }

  return <section className="access-card" aria-labelledby="captain-dispatch-title"><div className="access-card-heading"><span className="step-chip">DSH · Captain</span><p className="eyebrow">القبول والتوزيع</p><h2 id="captain-dispatch-title">تشغيل مسار الكابتن</h2><p className="muted">القبول ينشئ admission في DSH ثم يثبت actor واحدًا عبر Identity. التوزيع لا يعمل إلا للطلب الجاهز ولكابتن مؤهل ومتوافر، وفشل التسليم لا يحرر الكابتن أو يتيح إعادة التعيين تلقائيًا.</p></div><div className="access-form"><label className="field-label" htmlFor="captain-phone">هاتف الكابتن المراد قبوله<input id="captain-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" className="button button-primary" disabled={Boolean(busy) || !phone.trim()} onClick={() => void run("admit")}>{busy === "admit" ? "جارٍ القبول…" : "قبول Captain"}</button><label className="field-label" htmlFor="captain-order">معرّف الطلب للتوزيع<input id="captain-order" placeholder="order…" value={orderId} onChange={(event) => setOrderId(event.target.value)} /></label><div className="managed-status-actions"><button type="button" className="button button-primary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("dispatch")}>{busy === "dispatch" ? "جارٍ التوزيع…" : "إرسال عرض"}</button><button type="button" className="button button-secondary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("reassign")}>{busy === "reassign" ? "جارٍ إعادة التعيين…" : "إعادة التعيين"}</button></div><label className="field-label" htmlFor="captain-assignment">معرّف التكليف لاستعادة فشل التسليم<input id="captain-assignment" placeholder="assignment…" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} /></label><label className="field-label" htmlFor="captain-assignment-version">الإصدار المتوقع للتكليف<input id="captain-assignment-version" inputMode="numeric" placeholder="3" value={expectedVersion} onChange={(event) => setExpectedVersion(event.target.value)} /></label><button type="button" className="button button-secondary" disabled={Boolean(busy) || !assignmentId.trim() || !/^[1-9]\d*$/.test(expectedVersion.trim())} onClick={() => void run("recover")}>{busy === "recover" ? "جارٍ الاستعادة…" : "استعادة فشل التسليم"}</button></div>{result ? <div className="code-output" role="status"><p>العملية: {result.operation} · {result.idempotentReplay ? "إعادة قراءة idempotent" : "تم الحفظ"}</p>{result.admission ? <p>Admission: {result.admission.id} · Actor: {result.admission.actorId} · {result.admission.state} · {result.admission.availabilityState} · الإصدار {result.admission.version}</p> : null}{result.offer ? <p>العرض: {result.offer.id} · الطلب {result.offer.orderId} · Captain {result.offer.captainActorId} · {result.offer.state} · الإصدار {result.offer.version} · ينتهي {new Date(result.offer.expiresAt).toLocaleString("ar-YE")}</p> : null}{result.assignment ? <p>التكليف: {result.assignment.id} · الطلب {result.assignment.orderId} · {result.assignment.state} · تسليم المتجر {result.assignment.handoffState ?? "—"} · الإصدار {result.assignment.version}</p> : null}</div> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}</section>;
}
