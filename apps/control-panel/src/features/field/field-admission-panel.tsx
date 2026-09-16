"use client";

import { useState } from "react";

import { fieldAdmissionStateLabel, type FieldAdmission } from "@bthwani/dsh";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type FieldAdmissionResult = Readonly<{ admission: Readonly<{ id: string; actorId?: string | null; state: FieldAdmission["state"]; version: number }>; idempotentReplay: boolean }>;

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
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى خدمة التشغيل.");
    } finally { setBusy(false); }
  }

  return <section className="access-card" aria-labelledby="field-admission-title"><div className="access-card-heading"><span className="step-chip">القبول التشغيلي</span><p className="eyebrow">القبول الميداني</p><h2 id="field-admission-title">قبول ممثل ميداني</h2><p className="muted">القبول التشغيلي تملكه خدمة التشغيل: تنشئ حالة القبول، ثم تطلب من خدمة الهوية تثبيت ممثل قانوني واحد ودور الميدان.</p></div><div className="access-form"><label className="field-label" htmlFor="field-phone">هاتف الممثل الميداني<input id="field-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" className="button button-primary" disabled={busy || !phone.trim()} onClick={() => void admit()}>{busy ? "جارٍ القبول…" : "قبول الميدان"}</button></div>{result ? <div className="code-output" role="status"><p>تمت قراءة حالة القبول: {fieldAdmissionStateLabel(result.admission.state)}{result.idempotentReplay ? " · إعادة قراءة آمنة" : ""}</p><p>إدارة الدور وإيقافه لاحقًا تمر عبر حالة التشغيل نفسها.</p></div> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}</section>;
}
