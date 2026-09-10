"use client";

import { useState } from "react";
import type { PartnerBootstrapResponse } from "@bthwani/dsh";
import { responseMessage } from "./identity-client";

export function PartnerBootstrapPanel() {
  const [partnerActorId, setPartnerActorId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<PartnerBootstrapResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const actor = partnerActorId.trim();
    const name = storeName.trim();
    if (!actor || name.length < 2) {
      setError("أدخل معرّف الشريك واسم المتجر الأول.");
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
        body: JSON.stringify({ partnerActorId: actor, storeName: name }),
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
        <h2 id="partner-bootstrap-title">إنشاء منظمة الشريك وأول متجر</h2>
        <p className="muted">يُتحقق من دور المشغل والشريك عبر Identity، ثم تُنشأ الحقيقة التشغيلية في DSH بمعاملة واحدة قابلة لإعادة المحاولة بأمان.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="partner-actor-id">
          معرّف Actor الشريك
          <input id="partner-actor-id" disabled={busy} value={partnerActorId} onChange={(event) => { setPartnerActorId(event.target.value); resetRequest(); }} placeholder="act_…" />
        </label>
        <label className="field-label" htmlFor="first-store-name">
          اسم المتجر الأول
          <input id="first-store-name" disabled={busy} value={storeName} onChange={(event) => { setStoreName(event.target.value); resetRequest(); }} placeholder="اسم ظاهر للعميل" />
        </label>
        <button type="button" className="button button-primary" disabled={busy || !partnerActorId.trim() || storeName.trim().length < 2} onClick={() => void submit()}>
          {busy ? "جارٍ إنشاء الحقيقة التشغيلية…" : "إنشاء المنظمة والمتجر"}
        </button>
      </div>
      {result ? (
        <div className="managed-status managed-status-info" role="status">
          <strong>{result.idempotentReplay ? "تمت إعادة قراءة النتيجة الكانونية" : "تم إنشاء التهيئة الكانونية"}</strong>
          <p>Organization: <code>{result.partnerOrganization.id}</code></p>
          <p>Store: <code>{result.firstStore.id}</code> · {result.firstStore.name}</p>
          <p>المالك: <code>{result.partnerOrganization.ownerActorId}</code></p>
        </div>
      ) : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
