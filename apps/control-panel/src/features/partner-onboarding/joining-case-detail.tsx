"use client";

import { type CommerceVertical, type JoiningCaseResponse, joiningCaseStateLabel, publicationReadinessBlockedReasonLabel, publicationStateLabel, type ServiceCity, type StorePublicationResponse } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { partnerMutationHeaders } from "./partner-request";

export function JoiningCaseDetail({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<JoiningCaseResponse | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [publication, setPublication] = useState<StorePublicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [error, setError] = useState("");

  const readCase = useCallback(async (showLoading = true): Promise<boolean> => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}`, { cache: "no-store" });
      if (!response.ok) {
        setError(await partnerErrorMessage(response));
        return false;
      }
      setResult(await response.json() as JoiningCaseResponse);
      return true;
    } catch {
      setError("تعذر إعادة قراءة حالة الانضمام.");
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [caseId]);

  const readOptions = useCallback(async () => {
    const [citiesResponse, verticalsResponse] = await Promise.all([
      fetch("/api/service-cities", { cache: "no-store" }),
      fetch("/api/catalog/verticals", { cache: "no-store" }),
    ]).catch(() => [] as Response[]);
    if (citiesResponse?.ok) setCities((await citiesResponse.json() as { cities: ReadonlyArray<ServiceCity> }).cities);
    if (verticalsResponse?.ok) setVerticals((await verticalsResponse.json() as { verticals: ReadonlyArray<CommerceVertical> }).verticals);
  }, []);

  useEffect(() => {
    void readCase();
    void readOptions();
  }, [readCase, readOptions]);

  async function reconcileMutationError(response: Response, fallback: string) {
    const message = await partnerErrorMessage(response);
    await readCase(false);
    setError(message || fallback);
  }

  async function submitCase() {
    const current = result?.case;
    if (current?.state !== "draft") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/submit`, {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ expectedVersion: current.version }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر إرسال حالة الانضمام.");
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
    } catch {
      setError("تعذر إرسال حالة الانضمام. أعد قراءة الحالة قبل التكرار.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewCase(decision: "approved" | "needs_correction") {
    const current = result?.case;
    if (current?.state !== "submitted") return;
    if (decision === "needs_correction" && correctionReason.trim().length < 5) {
      setError("أدخل سبب التصحيح قبل إعادة الحالة.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/review`, {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ expectedVersion: current.version, decision, ...(correctionReason.trim() ? { correctionReason: correctionReason.trim() } : {}) }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر تسجيل قرار المراجعة.");
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
      setCorrectionReason("");
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
      setError(`لا يمكن نشر المتجر: ${publicationReadinessBlockedReasonLabel(publication.store.publicationReadiness.blockedReason)}`);
      return;
    }
    setPublicationBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(publication.store.id)}/publication`, {
        method: "POST",
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ state, expectedVersion: publication.store.version }),
      });
      if (!response.ok) {
        const message = await partnerErrorMessage(response);
        await readPublication();
        setError(message);
        return;
      }
      setPublication(await response.json() as StorePublicationResponse);
    } catch {
      setError("تعذر تنفيذ تغيير النشر. أعد قراءة الحالة قبل المحاولة مرة أخرى.");
    } finally {
      setPublicationBusy(false);
    }
  }

  if (loading) {
    return <section className="access-card" aria-labelledby="joining-case-detail-title"><h2 id="joining-case-detail-title">جارٍ قراءة حالة الانضمام…</h2></section>;
  }

  const current = result?.case;
  const storeId = current?.store?.id;
  const cityName = current?.serviceCityId ? cities.find((city) => city.id === current.serviceCityId)?.displayNameAr ?? "غير متاحة في القراءة الحالية" : "غير محددة";
  const verticalName = current?.firstStoreVerticalId ? verticals.find((vertical) => vertical.id === current.firstStoreVerticalId)?.nameAr ?? "غير متاح في القراءة الحالية" : "غير محدد";
  return (
    <section className="access-card" aria-labelledby="joining-case-detail-title">
      <div className="access-card-heading">
        <span className="step-chip">المورد: تفاصيل حالة الانضمام</span>
        <p className="eyebrow">مراجعة الحالة الكانونية</p>
        <h2 id="joining-case-detail-title">تفاصيل حالة انضمام الشريك</h2>
        <p className="muted">كل عملية تستخدم نسخة الحالة المقروءة وتعيد القراءة بعد التعارض أو الرفض من DSH.</p>
      </div>
      {!current ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر العثور على الحالة</strong><p>{error || "الحالة غير متاحة."}</p><button type="button" className="button button-secondary" onClick={() => void readCase()}>إعادة القراءة</button></div> : (
        <>
          <div className="managed-status managed-status-info" role="status">
            <strong>الحالة: {joiningCaseStateLabel(current.state)}</strong>
            <dl>
              <div><dt>النشاط</dt><dd>{current.businessName}</dd></div>
              <div><dt>المتجر الأول</dt><dd>{current.firstStoreName}</dd></div>
              <div><dt>الهاتف</dt><dd dir="ltr">{current.contactPhoneE164}</dd></div>
              <div><dt>مدينة الخدمة</dt><dd>{cityName}</dd></div>
              <div><dt>المجال التجاري</dt><dd>{verticalName}</dd></div>
              <div><dt>نسخة الحالة</dt><dd>{current.version}</dd></div>
            </dl>
            {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          </div>
          <div className="managed-status managed-status-info">
            <strong>العمليات المتاحة</strong>
            {current.state === "draft" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>إرسال للمراجعة</button> : null}
            {current.state === "submitted" ? <>
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<textarea className="resize-none" id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void reviewCase("approved")}>اعتماد الحالة وإنشاء المتجر</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </> : null}
            {current.state === "needs_correction" ? <p>الحالة بانتظار تصحيح بيانات الشريك عبر المسار القانوني المتاح.</p> : null}
            {current.state === "approved" ? <p>تم اعتماد الحالة. انتقل إلى قراءة النشر إن كان المتجر متاحًا.</p> : null}
          </div>
          {storeId ? <div className="managed-status managed-status-info"><strong>نشر المتجر</strong><p>{publication ? `الحالة الحالية: ${publicationStateLabel(publication.store.publicationState)}` : "لم تُقرأ حالة النشر بعد."}</p>{!publication ? <button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة قراءة النشر</button> : <><p>الجاهزية: {publication.store.publicationReadiness.ready ? "جاهز" : publicationReadinessBlockedReasonLabel(publication.store.publicationReadiness.blockedReason)}</p><button type="button" className="button button-primary" disabled={publicationBusy || (!publication.store.publicationReadiness.ready && publication.store.publicationState !== "published")} onClick={() => void changePublication()}>{publicationBusy ? "جارٍ التحديث…" : publication.store.publicationState === "published" ? "إخفاء المتجر" : "نشر المتجر"}</button><button type="button" className="button button-secondary" disabled={publicationBusy} onClick={() => void readPublication()}>إعادة القراءة</button></>}</div> : null}
        </>
      )}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      <div className="button-row"><Link className="button button-secondary" href="/partners">العودة إلى طابور الحالات</Link><button type="button" className="button button-secondary" disabled={busy || publicationBusy} onClick={() => void readCase()}>إعادة قراءة الحالة</button></div>
    </section>
  );
}
