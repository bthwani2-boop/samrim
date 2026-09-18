"use client";

import { captainAdmissionStateLabel, captainAvailabilityStateLabel, type CaptainAdmissionResponse } from "@bthwani/dsh";
import { useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

export function CaptainAdmissionPanel() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptainAdmissionResponse["admission"] | null>(null);
  const [error, setError] = useState("");

  async function admit() {
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone.replace(/\s+/g, ""))) {
      setError("أدخل رقم هاتف بصيغة E.164 مثل +96777000100.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admit", phone: phone.replace(/\s+/g, "") }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as { admission?: CaptainAdmissionResponse["admission"] };
      setResult(body.admission ?? null);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر الوصول إلى خدمة قبول الكباتن.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="access-card" aria-labelledby="captain-admission-title">
      <div className="access-card-heading">
        <span className="step-chip">الكباتن · أهلية دائمة</span>
        <p className="eyebrow">قبول منظم</p>
        <h2 id="captain-admission-title">إضافة كابتن إلى مسار التشغيل</h2>
        <p className="muted">تملك DSH أهلية الكابتن، وتملك Identity الدور والجلسة. لا يمنح هذا النموذج صلاحية تشغيل قبل اكتمال القراءة القانونية.</p>
      </div>
      <div className="access-form admission-form">
        <label className="field-label" htmlFor="captain-admission-phone">هاتف الكابتن المراد قبوله<input id="captain-admission-phone" autoComplete="tel" inputMode="tel" placeholder="+96777000100" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={busy} /></label>
        <button type="button" className="button button-primary" onClick={() => void admit()} disabled={busy || !phone.trim()}>{busy ? "جارٍ القبول…" : "قبول الكابتن"}</button>
      </div>
      {result ? <div className="managed-status managed-status-info" role="status"><strong>تمت إعادة قراءة أهلية الكابتن</strong><p>الحالة: {captainAdmissionStateLabel(result.state)} · التوفر: {captainAvailabilityStateLabel(result.availabilityState)}</p></div> : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
