"use client";

import { useState } from "react";

import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldAdmissionResult = Readonly<{ admission: Readonly<{ id: string; actorId?: string | null; state: string; version: number }>; idempotentReplay: boolean }>;

export function FieldAdmissionPanel() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FieldAdmissionResult | null>(null);
  const [error, setError] = useState("");

  async function admit() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactPhoneE164: phone }) });
      if (!response.ok) { setError(await responseMessage(response)); return; }
      setResult(await response.json() as FieldAdmissionResult);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى DSH.");
    } finally { setBusy(false); }
  }

  return <section className="access-card" aria-labelledby="field-admission-title"><div className="access-card-heading"><span className="step-chip">DSH · Field</span><p className="eyebrow">القبول الميداني</p><h2 id="field-admission-title">قبول ممثل ميداني</h2><p className="muted">القبول التشغيلي يملكه DSH: ينشئ admission، ثم يطلب من Identity تثبيت actor واحد ودور الميدان.</p></div><div className="access-form"><label className="field-label" htmlFor="field-phone">هاتف الممثل الميداني<input id="field-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" className="button button-primary" disabled={busy || !phone.trim()} onClick={() => void admit()}>{busy ? "جارٍ القبول…" : "قبول Field"}</button></div>{result ? <div className="code-output" role="status"><p>تمت قراءة admission الكانونية: {result.admission.id} · actor: {result.admission.actorId ?? "—"} · {result.admission.state} · الإصدار {result.admission.version}{result.idempotentReplay ? " · إعادة قراءة idempotent" : ""}</p><p>إدارة الدور وإيقافه لاحقًا تمر عبر حالة DSH نفسها.</p></div> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}</section>;
}
