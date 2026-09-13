"use client";

import type { JoiningCaseResponse, StorePublicationResponse } from "@bthwani/dsh";
import { useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

const joiningCaseStorageKey = "bthwani.control-panel.joining-case.current";
const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

export function JoiningCasePanel() {
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [result, setResult] = useState<JoiningCaseResponse | null>(null);
  const [publication, setPublication] = useState<StorePublicationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publicationBusy, setPublicationBusy] = useState(false);

  useEffect(() => {
    const caseId = window.localStorage.getItem(joiningCaseStorageKey)?.trim();
    if (!caseId) return;
    let active = true;
    setBusy(true);
    void fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (!response.ok) {
        if (response.status === 404) window.localStorage.removeItem(joiningCaseStorageKey);
        setError(await partnerErrorMessage(response));
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
    }).catch(() => {
      if (active) setError("تعذر استعادة حالة الانضمام المحفوظة من DSH.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, []);

  function rememberResult(next: JoiningCaseResponse) {
    setResult(next);
    window.localStorage.setItem(joiningCaseStorageKey, next.case.id);
  }

  function clearResult() {
    setResult(null);
    setPublication(null);
    setCorrectionReason("");
    setError("");
    window.localStorage.removeItem(joiningCaseStorageKey);
  }

  async function createCase() {
    const input = { contactPhoneE164: phone.replace(/\s+/g, ""), businessName: businessName.trim(), firstStoreName: storeName.trim() };
    if (!phoneE164Pattern.test(input.contactPhoneE164) || input.businessName.length < 2 || input.firstStoreName.length < 2) {
      setError("أدخل رقم هاتف الشريك واسم النشاط واسم المتجر الأول.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/partners/joining-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      rememberResult(await response.json() as JoiningCaseResponse);
      setPublication(null);
    } catch {
      setError("تعذر الوصول إلى مسار joining في DSH.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCase() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(result.case.id)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: result.case.version }),
      });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      rememberResult(await response.json() as JoiningCaseResponse);
    } catch {
      setError("تعذر إرسال joining case. أعد قراءة الحالة قبل التكرار.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewCase(decision: "approved" | "needs_correction") {
    if (!result) return;
    if (decision === "needs_correction" && correctionReason.trim().length < 5) {
      setError("أدخل سبب التصحيح قبل إعادة الحالة.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(result.case.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: result.case.version, decision, correctionReason: correctionReason.trim() }),
      });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      rememberResult(await response.json() as JoiningCaseResponse);
    } catch {
      setError("تعذر تسجيل قرار المراجعة. أعد قراءة الحالة قبل التكرار.");
    } finally {
      setBusy(false);
    }
  }

  async function readPublication() {
    const storeId = result?.case.store?.id;
    if (!storeId) return;
    setPublicationBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/publication`, { cache: "no-store" });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return;
      }
      setPublication(await response.json() as StorePublicationResponse);
    } catch {
      setError("تعذر إعادة قراءة حالة نشر المتجر.");
    } finally {
      setPublicationBusy(false);
    }
  }

  async function changePublication() {
    if (!publication) return;
    const state = publication.store.publicationState === "published" ? "hidden" : "published";
    if (state === "published" && !publication.store.publicationReadiness.ready) {
      setError("لا يمكن نشر المتجر قبل اجتياز بوابة هوية الشريك.");
      return;
    }
    setPublicationBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(publication.store.id)}/publication`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ state, expectedVersion: publication.store.version }),
      });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        await readPublication();
        return;
      }
      setPublication(await response.json() as StorePublicationResponse);
    } catch {
      setError("تعذر تنفيذ تغيير النشر. أعد قراءة الحالة قبل المحاولة مرة أخرى.");
    } finally {
      setPublicationBusy(false);
    }
  }

  const current = result?.case;
  const storeId = current?.store?.id;
  return (
    <section className="access-card" aria-labelledby="joining-case-title">
      <div className="access-card-heading">
        <span className="step-chip">J1 · DSH</span>
        <p className="eyebrow">حالة انضمام الشريك</p>
        <h2 id="joining-case-title">مراجعة طلب انضمام الشريك</h2>
        <p className="muted">ينشئ DSH حالة انضمام prospective، ثم يطلب هوية الشريك من Identity عند الإرسال، ولا ينشئ سجل actor محليًا.</p>
      </div>
      {!current ? (
        <div className="access-form">
          <label className="field-label" htmlFor="joining-phone">رقم هاتف الشريك (E.164)<input id="joining-phone" autoComplete="tel" disabled={busy} inputMode="tel" value={phone} onChange={(event) => { setPhone(event.target.value); clearResult(); }} placeholder="مثال: +96777000100" /></label>
          <label className="field-label" htmlFor="joining-business">اسم النشاط<input id="joining-business" disabled={busy} value={businessName} onChange={(event) => { setBusinessName(event.target.value); clearResult(); }} /></label>
          <label className="field-label" htmlFor="joining-store">اسم المتجر الأول<input id="joining-store" disabled={busy} value={storeName} onChange={(event) => { setStoreName(event.target.value); clearResult(); }} /></label>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void createCase()}>{busy ? "جارٍ إنشاء الحالة…" : "إنشاء حالة انضمام"}</button>
        </div>
      ) : (
        <div className="managed-status managed-status-info" role="status">
          <strong>الحالة: {current.state}</strong>
          <p>Case: <code>{current.id}</code> · الإصدار <code>{current.version}</code></p>
          <p>{current.businessName} · {current.firstStoreName}</p>
          {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          {current.state === "draft" || current.state === "needs_correction" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>إرسال للمراجعة</button> : null}
          {current.state === "submitted" ? (
            <>
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<textarea id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void reviewCase("approved")}>اعتماد الحالة وإنشاء Store</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </>
          ) : null}
          {storeId ? <p>Store: <code>{storeId}</code> · {current.store?.name}</p> : null}
          {storeId && !publication ? <button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة قراءة النشر</button> : null}
          {publication ? <div className="managed-status managed-status-info"><strong>نشر Store: {publication.store.publicationState}</strong><p>الجاهزية: {publication.store.publicationReadiness.ready ? "جاهز" : "محجوب"}</p><button type="button" className="button button-primary" disabled={publicationBusy || (!publication.store.publicationReadiness.ready && publication.store.publicationState !== "published")} onClick={() => void changePublication()}>{publicationBusy ? "جارٍ التحديث…" : publication.store.publicationState === "published" ? "إخفاء Store" : "نشر Store"}</button><button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة القراءة</button></div> : null}
          <button type="button" className="button button-secondary" disabled={busy || publicationBusy} onClick={clearResult}>حالة انضمام جديدة</button>
        </div>
      )}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
