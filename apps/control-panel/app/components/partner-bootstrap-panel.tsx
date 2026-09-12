"use client";

import type { PartnerBootstrapResponse } from "@bthwani/dsh";
import { useState } from "react";
import { responseMessage } from "./identity-client";

export function PartnerBootstrapPanel() {
  const [partnerPhone, setPartnerPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<PartnerBootstrapResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const phone = partnerPhone.trim();
    const name = storeName.trim();
    if (!phone || name.length < 2) {
      setError("أدخل رقم هاتف الشريك واسم المتجر الأول.");
      return;
    }
    const key = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(key);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/partners/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ partnerPhone: phone, storeName: name }),
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      setResult(await response.json() as PartnerBootstrapResponse);
    } catch {
      setError("تعذر الوصول إلى مسار تهيئة الشريك.");
    } finally {
      setBusy(false);
    }
  }

  function resetRequest() {
    setResult(null);
    setError("");
    setIdempotencyKey("");
  }

  return (
    <section className="access-card" aria-labelledby="partner-bootstrap-title">
      <div className="access-card-heading">
        <span className="step-chip">J2.1 · DSH</span>
        <p className="eyebrow">تهيئة الشريك</p>
        <h2 id="partner-bootstrap-title">إنشاء المتجر الأول للشريك</h2>
        <p className="muted">أدخل رقم هاتف الشريك؛ يقرأ النظام معرّف <code>actor_id</code> الموثوق من Identity ويربط المتجر الأول به مباشرةً داخل DSH، دون إنشاء كيان شريك موازٍ.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="partner-phone">
          رقم هاتف الشريك
          <input id="partner-phone" autoComplete="tel" disabled={busy} inputMode="tel" value={partnerPhone} onChange={(event) => { setPartnerPhone(event.target.value); resetRequest(); }} placeholder="مثال: 967 77 000 100" />
        </label>
        <label className="field-label" htmlFor="first-store-name">
          اسم المتجر الأول
          <input id="first-store-name" disabled={busy} value={storeName} onChange={(event) => { setStoreName(event.target.value); resetRequest(); }} placeholder="اسم ظاهر للعميل" />
        </label>
        <button type="button" className="button button-primary" disabled={busy || !partnerPhone.trim() || storeName.trim().length < 2} onClick={() => void submit()}>
          {busy ? "جارٍ إنشاء المتجر…" : "إنشاء المتجر الأول"}
        </button>
      </div>
      {result ? (
        <div className="managed-status managed-status-info" role="status">
          <strong>{result.idempotentReplay ? "تمت إعادة قراءة النتيجة الكانونية" : "تم إنشاء التهيئة الكانونية"}</strong>
          <p>Partner actor: <code>{result.partnerActorId}</code></p>
          <p>Store: <code>{result.firstStore.id}</code> · {result.firstStore.name}</p>
        </div>
      ) : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
