"use client";

import { useState } from "react";

import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

export function CaptainDispatchPanel() {
  const [phone, setPhone] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");

  async function run(action: "admit" | "dispatch" | "reassign") {
    setBusy(action); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/captains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone, orderId }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      setResult(await response.json());
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى DSH.");
    } finally { setBusy(""); }
  }

  return <section className="access-card" aria-labelledby="captain-dispatch-title"><div className="access-card-heading"><span className="step-chip">DSH · Captain</span><p className="eyebrow">القبول والتوزيع</p><h2 id="captain-dispatch-title">تشغيل مسار الكابتن</h2><p className="muted">القبول ينشئ admission في DSH ثم يثبت actor واحدًا عبر Identity. التوزيع لا يعمل إلا للطلب الجاهز ولكابتن مؤهل ومتوافر.</p></div><div className="access-form"><label className="field-label" htmlFor="captain-phone">هاتف الكابتن المراد قبوله<input id="captain-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" className="button button-primary" disabled={Boolean(busy) || !phone.trim()} onClick={() => void run("admit")}>{busy === "admit" ? "جارٍ القبول…" : "قبول Captain"}</button><label className="field-label" htmlFor="captain-order">معرّف الطلب للتوزيع<input id="captain-order" placeholder="order…" value={orderId} onChange={(event) => setOrderId(event.target.value)} /></label><div className="managed-status-actions"><button type="button" className="button button-primary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("dispatch")}>{busy === "dispatch" ? "جارٍ التوزيع…" : "إرسال عرض"}</button><button type="button" className="button button-secondary" disabled={Boolean(busy) || !orderId.trim()} onClick={() => void run("reassign")}>{busy === "reassign" ? "جارٍ إعادة التعيين…" : "إعادة التعيين"}</button></div></div>{result ? <pre className="code-output" role="status">{JSON.stringify(result, null, 2)}</pre> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}</section>;
}
