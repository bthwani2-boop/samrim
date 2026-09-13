"use client";

import type { PartnerBootstrapResponse, StorePublicationResponse } from "@bthwani/dsh";
import { useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

export function PartnerBootstrapPanel() {
  const [partnerPhone, setPartnerPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<PartnerBootstrapResponse | null>(null);
  const [publication, setPublication] = useState<StorePublicationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [error, setError] = useState("");
  const [publicationError, setPublicationError] = useState("");

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
        setError(await partnerErrorMessage(response));
        return;
      }
      const next = await response.json() as PartnerBootstrapResponse;
      setResult(next);
      setPublication({ store: next.firstStore, idempotentReplay: next.idempotentReplay });
      setPublicationError("");
    } catch {
      setError("تعذر الوصول إلى مسار تهيئة الشريك.");
    } finally {
      setBusy(false);
    }
  }

  function resetRequest() {
    setResult(null);
    setPublication(null);
    setError("");
    setPublicationError("");
    setIdempotencyKey("");
  }

  async function readPublication() {
    if (!result) return;
    setPublicationBusy(true);
    setPublicationError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(result.firstStore.id)}/publication`, { cache: "no-store" });
      if (!response.ok) {
        setPublicationError(await partnerErrorMessage(response));
        return;
      }
      setPublication(await response.json() as StorePublicationResponse);
    } catch {
      setPublicationError("تعذر إعادة قراءة حالة النشر الكانونية.");
    } finally {
      setPublicationBusy(false);
    }
  }

  async function changePublication() {
    if (!result || !publication) return;
    const state = publication.store.publicationState === "published" ? "hidden" : "published";
    if (state === "published" && !publication.store.publicationReadiness.ready) {
      setPublicationError("لا يمكن نشر المتجر قبل اجتياز جاهزية النشر الحالية.");
      return;
    }
    setPublicationBusy(true);
    setPublicationError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(result.firstStore.id)}/publication`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ state, expectedVersion: publication.store.version }),
      });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        await readPublication();
        setPublicationError(message);
        return;
      }
      setPublication(await response.json() as StorePublicationResponse);
    } catch {
      setPublicationError("تعذر تنفيذ تغيير النشر. أعد قراءة الحالة قبل المحاولة مرة أخرى.");
    } finally {
      setPublicationBusy(false);
    }
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
          {publication ? (
            <div className="managed-status managed-status-info">
              <strong>حالة النشر الكانونية: {publication.store.publicationState}</strong>
              <p>الإصدار الحالي: <code>{publication.store.version}</code></p>
              <p>جاهزية النشر: {publication.store.publicationReadiness.ready ? "جاهز" : "محجوب"}</p>
              {!publication.store.publicationReadiness.ready && publication.store.publicationReadiness.blockedReason === "PARTNER_IDENTITY_NOT_ELIGIBLE" ? <p role="alert">هوية الشريك غير مؤهلة حاليًا للنشر.</p> : null}
              <button type="button" className="button button-primary" disabled={publicationBusy || (!publication.store.publicationReadiness.ready && publication.store.publicationState !== "published")} onClick={() => void changePublication()}>
                {publicationBusy ? "جارٍ تحديث النشر…" : publication.store.publicationState === "published" ? "إخفاء المتجر" : "نشر المتجر"}
              </button>
              <button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>
                إعادة قراءة الحالة
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      {publicationError ? <p className="identity-error" role="alert">{publicationError}</p> : null}
    </section>
  );
}
