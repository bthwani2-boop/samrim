"use client";

import { joiningCaseStateLabel, publicationStateLabel, type CommerceVertical, type JoiningCaseListResponse, type JoiningCaseResponse, type ServiceCity, type StorePublicationResponse } from "@bthwani/dsh";
import { toAsciiDigits } from "@bthwani/design-system";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";

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
  const [queue, setQueue] = useState<JoiningCaseListResponse["cases"]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [serviceCityId, setServiceCityId] = useState("");
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [verticalsBusy, setVerticalsBusy] = useState(true);
  const [verticalsError, setVerticalsError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadQueue = useCallback(async () => {
    setQueueBusy(true);
    setQueueError("");
    try {
      const response = await fetch("/api/partners/joining-cases?limit=50", { cache: "no-store" });
      if (!response.ok) {
        setQueueError(await partnerErrorMessage(response));
        return;
      }
      setQueue((await response.json() as JoiningCaseListResponse).cases);
    } catch {
      setQueueError("تعذر قراءة طابور حالات الانضمام.");
    } finally {
      setQueueBusy(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  useEffect(() => {
    void fetch("/api/service-cities", { cache: "no-store" }).then(async (response) => response.ok ? setCities((await response.json() as { cities: ReadonlyArray<ServiceCity> }).cities) : setCities([]), () => setCities([]));
  }, []);

  const loadVerticals = useCallback(async () => {
    setVerticalsBusy(true);
    setVerticalsError("");
    try {
      const response = await fetch("/api/catalog/verticals", { cache: "no-store" });
      if (!response.ok) {
        setVerticalsError(await partnerErrorMessage(response));
        return;
      }
      setVerticals((await response.json() as { verticals: ReadonlyArray<CommerceVertical> }).verticals);
    } catch {
      setVerticalsError("تعذر قراءة المجالات التجارية.");
    } finally {
      setVerticalsBusy(false);
    }
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);

  function rememberResult(next: JoiningCaseResponse) {
    setResult(next);
  }

  function clearResult() {
    setResult(null);
    setPublication(null);
    setCorrectionReason("");
    setError("");
  }

  async function openCase(caseId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        await loadQueue();
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
      setPublication(null);
    } catch {
      setError("تعذر فتح حالة الانضمام.");
    } finally {
      setBusy(false);
    }
  }

  async function createCase() {
    const input = { contactPhoneE164: phone.replace(/\s+/g, ""), businessName: businessName.trim(), firstStoreName: storeName.trim(), serviceCityId, firstStoreVerticalId: verticalId };
    if (!phoneE164Pattern.test(input.contactPhoneE164) || input.businessName.length < 2 || input.firstStoreName.length < 2 || !input.serviceCityId || !input.firstStoreVerticalId) {
      setError("أدخل هاتف الشريك والاسم القانوني للنشاط واسم المتجر الأول واختر المدينة والمجال التجاري.");
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
      void loadQueue();
    } catch {
      setError("تعذر الوصول إلى مسار حالة الانضمام.");
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
      void loadQueue();
    } catch {
      setError("تعذر إرسال حالة الانضمام. أعد قراءة الحالة قبل التكرار.");
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
      void loadQueue();
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
  const activeVerticals = verticals.filter((vertical) => vertical.active);
  return (
    <section className="access-card" aria-labelledby="joining-case-title">
      <div className="access-card-heading">
        <span className="step-chip">مسار الانضمام</span>
        <p className="eyebrow">حالة انضمام الشريك</p>
        <h2 id="joining-case-title">مراجعة طلب انضمام الشريك</h2>
        <p className="muted">تنشئ المنصة حالة انضمام للشريك، ثم تطلب إثبات هويته عند الإرسال، ولا تنشئ سجلًا محليًا بديلًا.</p>
      </div>
      {!current ? (
        <>
        <div className="managed-status managed-status-info" role="status">
          <strong>طابور حالات الانضمام الكانوني</strong>
          <p>يمكن لأي متصفح جديد اكتشاف الحالات المحفوظة؛ لا يعتمد الاستئناف على جهاز بعينه.</p>
          {queueBusy ? <p>جارٍ تحميل الطابور…</p> : null}
          {queueError ? <p role="alert">{queueError} <button type="button" className="button button-secondary" onClick={() => void loadQueue()}>إعادة المحاولة</button></p> : null}
          {!queueBusy && !queueError && queue.length === 0 ? <p>لا توجد حالات انضمام حاليًا.</p> : null}
          {queue.length ? <ul>{queue.map((item) => <li key={item.id}><button type="button" className="button button-secondary" disabled={busy} onClick={() => void openCase(item.id)}>{joiningCaseStateLabel(item.state)} · {item.businessName}</button></li>)}</ul> : null}
        </div>
        {!creating ? <div className="managed-status managed-status-info"><strong>ابدأ من الطابور</strong><p>اختر حالة قائمة لاستئنافها، أو افتح إنشاء حالة مستقلة عند توفر بيانات الشريك الأولية.</p><button type="button" className="button button-primary" onClick={() => setCreating(true)}>إنشاء حالة انضمام جديدة</button></div> : null}
        {creating ? <>
        {verticalsError ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر تحميل المجالات التجارية</strong><p>{verticalsError}</p><button type="button" className="button button-secondary" disabled={verticalsBusy || busy} onClick={() => void loadVerticals()}>إعادة قراءة المجالات</button></div> : null}
        {!verticalsBusy && !verticalsError && activeVerticals.length === 0 ? <div className="managed-status managed-status-warning" role="alert"><strong>لا يمكن إنشاء طلب شريك بعد</strong><p>يجب أن يضيف المشغل مجالًا تجاريًا نشطًا من الكتالوج أولًا، ثم تعود لاختيار المجال هنا.</p><Link className="button button-secondary" href="/catalog">فتح الكتالوج لإضافة مجال</Link></div> : null}
        <div className="access-form">
          <label className="field-label" htmlFor="joining-phone">رقم هاتف الشريك (E.164)<input id="joining-phone" autoComplete="tel" disabled={busy} inputMode="tel" value={phone} onChange={(event) => { setPhone(toAsciiDigits(event.target.value)); clearResult(); }} placeholder="مثال: +96777000100" /></label>
          <label className="field-label" htmlFor="joining-business">الاسم القانوني للنشاط<input id="joining-business" disabled={busy} value={businessName} onChange={(event) => { setBusinessName(event.target.value); clearResult(); }} /></label>
          <label className="field-label" htmlFor="joining-store">اسم المتجر الأول<input id="joining-store" disabled={busy} value={storeName} onChange={(event) => { setStoreName(event.target.value); clearResult(); }} /></label>
          <label className="field-label" htmlFor="joining-city">مدينة المتجر الأول<select id="joining-city" disabled={busy} value={serviceCityId} onChange={(event) => { setServiceCityId(event.target.value); clearResult(); }}><option value="">اختر مدينة نشطة</option>{cities.filter((city) => city.active).map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <label className="field-label" htmlFor="joining-vertical">المجال التجاري<select id="joining-vertical" disabled={busy || verticalsBusy || Boolean(verticalsError)} value={verticalId} onChange={(event) => { setVerticalId(event.target.value); clearResult(); }}><option value="">{verticalsBusy ? "جارٍ تحميل المجالات…" : verticalsError ? "تعذر تحميل المجالات" : activeVerticals.length ? "اختر المجال التجاري" : "لا توجد مجالات نشطة"}</option>{activeVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label>
          <button type="button" className="button button-primary" disabled={busy || verticalsBusy || Boolean(verticalsError) || activeVerticals.length === 0} onClick={() => void createCase()}>{busy ? "جارٍ إنشاء الحالة…" : "إنشاء حالة انضمام"}</button>
        </div>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => setCreating(false)}>إلغاء الإنشاء</button>
        </> : null}
        </>
      ) : (
        <div className="managed-status managed-status-info" role="status">
          <strong>الحالة: {joiningCaseStateLabel(current.state)}</strong>
          <p>{current.businessName} · {current.firstStoreName}</p>
          <p>مدينة المتجر الأول: {cities.find((city) => city.id === current.serviceCityId)?.displayNameAr || "مدينة غير معرّفة"}</p>
          <p>المجال التجاري: {verticals.find((vertical) => vertical.id === current.firstStoreVerticalId)?.nameAr || "مجال غير معرّف"}</p>
          {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          {current.state === "draft" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>إرسال للمراجعة</button> : null}
          {current.state === "submitted" ? (
            <>
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<textarea className="resize-none" id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void reviewCase("approved")}>اعتماد الحالة وإنشاء المتجر</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </>
          ) : null}
          {storeId ? <p>المتجر: {current.store?.name}</p> : null}
          {storeId && !publication ? <button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة قراءة النشر</button> : null}
          {publication ? <div className="managed-status managed-status-info"><strong>حالة النشر: {publicationStateLabel(publication.store.publicationState)}</strong><p>الجاهزية: {publication.store.publicationReadiness.ready ? "جاهز" : "محجوب"}</p><button type="button" className="button button-primary" disabled={publicationBusy || (!publication.store.publicationReadiness.ready && publication.store.publicationState !== "published")} onClick={() => void changePublication()}>{publicationBusy ? "جارٍ التحديث…" : publication.store.publicationState === "published" ? "إخفاء المتجر" : "نشر المتجر"}</button><button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة القراءة</button></div> : null}
          <button type="button" className="button button-secondary" disabled={busy || publicationBusy} onClick={() => { clearResult(); setCreating(false); }}>العودة إلى طابور الحالات</button>
        </div>
      )}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>
  );
}
