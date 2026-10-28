"use client";
import { TextArea } from "@bthwani/design-system/web";

import { type CommerceVertical, type CommercialStoreType, financialProfileStateLabel, type JoiningCaseProofDetailsResponse, type JoiningCaseProofType, type JoiningCaseResponse, joiningCaseStateLabel, type MediaProvenanceInput, type PartnerFinancialTermsPolicy, type ServiceCity, type StoreFulfillmentMode, settlementPeriodLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { partnerErrorMessage } from "../partners/partner-error-message";
import { stablePartnerMutationHeaders } from "../partners/partner-request";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { StoreLogo } from "../stores/store-logo";
import { StoreZeroCommissionProposal } from "./store-zero-commission-proposal";
import { PartnerCaseFieldAttribution } from "./partner-case-field-attribution";
import { canOperatorAdmitJoiningCase } from "./joining-case-admission-rules";

const fulfillmentModeOptions: ReadonlyArray<Readonly<{ value: StoreFulfillmentMode; label: string; description: string }>> = [
  { value: "BTHWANI_CAPTAIN", label: "توصيل بثواني", description: "المنصة تتولى إسناد التوصيل وإدارته." },
  { value: "PARTNER_CAPTAIN", label: "توصيل المتجر", description: "المتجر يعيّن كابتنًا نشطًا من كباتن متجره." },
  { value: "CUSTOMER_PICKUP", label: "استلم بنفسك من المتجر", description: "يذهب العميل إلى المتجر لاستلام الطلب." },
];

const proofTypeLabels: Record<JoiningCaseProofType, string> = {
  COMMERCIAL_REGISTRATION: "سجل تجاري",
  IDENTITY_DOCUMENT: "هوية",
  FREELANCE_WORK_DOCUMENT: "وثيقة عمل حر (سجل قديم)",
  PASSPORT: "جواز سفر",
};

const weekdays = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"] as const;

export function JoiningCaseDetail({ caseId, embedded = false }: { caseId: string; embedded?: boolean }) {
  const { state: sessionState } = useSession();
  const canManageFinancialTerms = sessionState.kind === "authenticated" && sessionState.identity.permissions?.includes("finance") === true && sessionState.identity.permissions?.includes("platform_policies") === true;
  const [result, setResult] = useState<JoiningCaseResponse | null>(null);
  const [proofDetails, setProofDetails] = useState<{ caseId: string; response: JoiningCaseProofDetailsResponse } | null>(null);
  const [proofDetailsError, setProofDetailsError] = useState<{ caseId: string; message: string } | null>(null);
  const [proofDetailsLoading, setProofDetailsLoading] = useState(false);
  const [storeImageFile, setStoreImageFile] = useState<File | null>(null);
  const [storeCoverFile, setStoreCoverFile] = useState<File | null>(null);
  const [storeImageProvenance, setStoreImageProvenance] = useState<MediaProvenanceInput>({ creator: "", sourceDescription: "", sourceUri: "", rightsStatement: "", rightsUri: "", rightsAttested: false });
  const [activeTermsPolicy, setActiveTermsPolicy] = useState<PartnerFinancialTermsPolicy | null>(null);
  const [policyReadMessage, setPolicyReadMessage] = useState("");
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const readProofDetails = useCallback(async () => {
    setProofDetailsLoading(true);
    setProofDetailsError(null);
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/proof-details`, { cache: "no-store" });
      if (!response.ok) throw new Error("JOINING_CASE_PROOF_DETAILS_UNAVAILABLE");
      setProofDetails({ caseId, response: await response.json() as JoiningCaseProofDetailsResponse });
    } catch {
      setProofDetails(null);
      setProofDetailsError({ caseId, message: "تعذر قراءة بيانات الإثبات الخاصة بصلاحية المشغّل." });
    } finally {
      setProofDetailsLoading(false);
    }
  }, [caseId]);

  const readFinancialTermsPolicy = useCallback(async () => {
    if (!canManageFinancialTerms) {
      setActiveTermsPolicy(null);
      setPolicyReadMessage("يتطلب اعتماد الشروط صلاحية المالية وسياسات المنصة؛ اطلب منح الصلاحيتين للمشغّل.");
      return;
    }
    try {
      const response = await fetch("/api/finance/partner-financial-terms-policy", { cache: "no-store" });
      const body = await response.json() as { policy?: PartnerFinancialTermsPolicy };
      if (!response.ok || !body.policy) {
        setActiveTermsPolicy(null);
        setPolicyReadMessage(response.status === 404 ? "لا توجد شروط مالية نشطة. أنشئها من قسم السياسات قبل الاعتماد." : "تعذرت قراءة الشروط المالية النشطة.");
        return;
      }
      setActiveTermsPolicy(body.policy);
      setPolicyReadMessage("");
    } catch {
      setActiveTermsPolicy(null);
      setPolicyReadMessage("تعذرت قراءة الشروط المالية النشطة.");
    }
  }, [canManageFinancialTerms]);

  useEffect(() => {
    void readCase();
    void readOptions();
  }, [readCase, readOptions]);

  // Financial terms are only needed for approval or recovery, not for every draft visit.
  const needsTerms = result?.case.state === "approved" && result?.case.financialProfileState === "REQUIRED";
  useEffect(() => {
    if (needsTerms) void readFinancialTermsPolicy();
  }, [needsTerms, readFinancialTermsPolicy]);
  useReadOnReturn(() => readCase(false), !busy && !correctionReason.trim() && !storeImageFile);

  const currentVerticalId = result?.case.firstStoreVerticalId ?? "";
  useEffect(() => {
    setCommercialTypes([]);
    if (!currentVerticalId) return;
    const controller = new AbortController();
    void fetch(`/api/catalog/commercial-store-types?verticalId=${encodeURIComponent(currentVerticalId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { storeTypes?: ReadonlyArray<CommercialStoreType> };
        if (!controller.signal.aborted) setCommercialTypes(body.storeTypes ?? []);
      })
      .catch(() => {
        // The stored type ID remains visible below when its display name is unavailable.
      });
    return () => controller.abort();
  }, [currentVerticalId]);

  async function reconcileMutationError(response: Response, fallback: string, refreshPolicy = false) {
    const message = await partnerErrorMessage(response);
    await Promise.all([readCase(false), ...(refreshPolicy ? [readFinancialTermsPolicy()] : [])]);
    setError(message || fallback);
  }

  async function uploadIntakeImage(role: "primary" | "cover") {
    const current = result?.case;
    const file = role === "cover" ? storeCoverFile : storeImageFile;
    if (!current || (current.state !== "draft" && !(current.state === "approved" && current.store?.id)) || !file || busy) return;
    if (storeImageProvenance.creator.trim().length < 2 || storeImageProvenance.sourceDescription.trim().length < 3 || storeImageProvenance.rightsStatement.trim().length < 5 || !storeImageProvenance.rightsAttested) {
      setError("أكمل منشئ صورة الواجهة ومصدرها وبيان حق استخدامها، وأكّد صحة التصريح.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const headers = new Headers(await stablePartnerMutationHeaders(`joining-case-store-image:${role}:${caseId}:${current.version}:${file.name}:${file.size}:${file.lastModified}`));
      headers.delete("Content-Type");
      headers.set("X-Expected-Version", String(current.version));
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("role", role);
        form.set("creator", storeImageProvenance.creator);
        form.set("sourceDescription", storeImageProvenance.sourceDescription);
        form.set("sourceUri", storeImageProvenance.sourceUri ?? "");
        form.set("rightsStatement", storeImageProvenance.rightsStatement);
        form.set("rightsUri", storeImageProvenance.rightsUri ?? "");
        form.set("rightsAttested", String(storeImageProvenance.rightsAttested));
      const suffix = "store-image";
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/${suffix}`, { method: "POST", headers, body: form });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر رفع صورة واجهة المتجر.");
        return;
      }
      const updated = await response.json() as JoiningCaseResponse;
      setResult(updated);
      if (role === "cover") setStoreCoverFile(null); else setStoreImageFile(null);
    } catch {
      await readCase(false);
      setError("تعذر تأكيد رفع الصورة. أُعيدت قراءة الحالة؛ تحقق من حالة الملف قبل تكرار الرفع.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCase() {
    const current = result?.case;
    const canAdmit = current && canOperatorAdmitJoiningCase(current.origin, current.state);
    if (!current || !canAdmit) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/submit`, {
        method: "POST",
        headers: await stablePartnerMutationHeaders(`joining-case-admission:${caseId}:${current.version}`),
        body: JSON.stringify({ expectedVersion: current.version }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر إرسال حالة الانضمام.");
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
    } catch {
      await readCase(false);
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
        headers: await stablePartnerMutationHeaders(`joining-case-review:${caseId}:${current.version}:${decision}:${correctionReason.trim()}`),
        body: JSON.stringify({
          expectedVersion: current.version,
          decision,
          ...(correctionReason.trim() ? { correctionReason: correctionReason.trim() } : {}),
        }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر تسجيل قرار المراجعة.", decision === "approved");
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
      setCorrectionReason("");
      if (decision === "approved") await readFinancialTermsPolicy();
    } catch {
      await readCase(false);
      setError("تعذر تسجيل قرار المراجعة. أعد قراءة الحالة قبل التكرار.");
    } finally {
      setBusy(false);
    }
  }

  async function bindFinancialTerms() {
    const current = result?.case;
    if (current?.state !== "approved" || current.financialProfileState !== "REQUIRED" || !canManageFinancialTerms || !activeTermsPolicy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/partners/joining-cases/" + encodeURIComponent(caseId) + "/financial-terms", {
        method: "POST",
        headers: await stablePartnerMutationHeaders(`joining-case-financial-terms:${caseId}:${current.version}:${activeTermsPolicy.policyVersion}`),
        body: JSON.stringify({ expectedVersion: current.version, expectedTermsPolicyVersion: activeTermsPolicy.policyVersion }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر استكمال الربط المالي.", true);
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
    } catch {
      await readCase(false);
      setError("تعذر استكمال الربط المالي. أعد قراءة الحالة قبل التكرار.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className="access-card" aria-labelledby="joining-case-detail-title"><h2 id="joining-case-detail-title">جارٍ قراءة حالة الانضمام…</h2></section>;
  }

  const current = result?.case;
  const requestedProof = proofDetails?.caseId === caseId ? proofDetails.response : null;
  const requestedProofError = proofDetailsError?.caseId === caseId ? proofDetailsError.message : "";
  const storeId = current?.store?.id;
  const cityName = current?.serviceCityId ? cities.find((city) => city.id === current.serviceCityId)?.displayNameAr ?? "غير متاحة في القراءة الحالية" : "غير محددة";
  const verticalName = current?.firstStoreVerticalId ? verticals.find((vertical) => vertical.id === current.firstStoreVerticalId)?.nameAr ?? "غير متاح في القراءة الحالية" : "غير محدد";
  const commercialTypeName = current?.firstStoreCommercialTypeId
    ? commercialTypes.find((type) => type.id === current.firstStoreCommercialTypeId)?.nameAr ?? current.firstStoreCommercialTypeId
    : "غير متاح في بيانات الحالة القديمة";
  return (
    <section className="access-card" aria-labelledby="joining-case-detail-title">
      <div className="access-card-heading">
        <h2 id="joining-case-detail-title">طلب انضمام الشريك</h2>
      </div>
      {!current ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر العثور على الحالة</strong><p>{error || "الحالة غير متاحة."}</p><button type="button" className="button button-secondary" onClick={() => void readCase()}>إعادة القراءة</button></div> : (
        <>
          <section className="partner-case-summary" aria-label="ملخص طلب الانضمام">
            <div className="partner-case-summary-main">
              <StoreLogo name={current.firstStoreName} uri={current.storeProfileImage?.uri} />
              <div>
                <h3>{current.firstStoreName}</h3>
                <p>{current.ownerFullName?.trim() || "اسم المالك غير مسجل"} · <a href={`tel:${current.contactPhoneE164}`}><bdi dir="ltr">{current.contactPhoneE164}</bdi></a></p>
                <p>{cityName} · {verticalName}</p>
              </div>
            </div>
            <div className="partner-case-summary-actions">
              <span className="status-badge" role="status">الحالة: {joiningCaseStateLabel(current.state)}</span>
              {storeId ? <Link className="button button-secondary" href={`/partners/stores/${encodeURIComponent(storeId)}`}>فتح ملف المتجر</Link> : null}
              {current.partnerActorId ? <Link className="button button-secondary" href={`/partners/actors/${encodeURIComponent(current.partnerActorId)}`}>فتح ملف الشريك</Link> : null}
              <a className="button button-primary" href="#joining-case-actions">متابعة الإجراء</a>
            </div>
          </section>
          <details className="partner-case-details">
            <summary>تفاصيل الانضمام والتوثيق</summary>
            <dl className="facts-grid">
              <div><dt>اسم المالك</dt><dd>{current.ownerFullName || "غير مسجل في هذه الحالة"}</dd></div>
              <div><dt>رقم جوال المالك</dt><dd dir="ltr">{current.contactPhoneE164 || "غير مسجل"}</dd></div>
              <div><dt>اسم النشاط</dt><dd>{current.businessName || "غير مسجل"}</dd></div>
              <div><dt>اسم المتجر</dt><dd>{current.firstStoreName || "غير مسجل"}</dd></div>
              <div><dt>مدينة الخدمة</dt><dd>{cityName}</dd></div>
              <div><dt>العنوان</dt><dd>{current.firstStoreAddress || "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>المجال التجاري</dt><dd>{verticalName}</dd></div>
              <div><dt>نوع المتجر</dt><dd>{commercialTypeName}</dd></div>
              <div><dt>موقع المتجر على الخريطة</dt><dd>{current.firstStoreLatitude != null && current.firstStoreLongitude != null ? <a href={`https://www.google.com/maps?q=${current.firstStoreLatitude},${current.firstStoreLongitude}`} target="_blank" rel="noopener noreferrer">فتح موقع المتجر على الخريطة</a> : "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>ساعات العمل</dt><dd>{current.firstStoreWorkingHours ? current.firstStoreWorkingHours.intervals.length > 0 ? <ul>{current.firstStoreWorkingHours.intervals.map((interval) => <li key={`${interval.dayOfWeek}-${interval.opensAt}-${interval.closesAt}`}>{weekdays[interval.dayOfWeek - 1] ?? `اليوم ${interval.dayOfWeek}`}: {interval.opensAt}–{interval.closesAt}{interval.closesNextDay ? " (اليوم التالي)" : ""}</li>)}</ul> : "لا توجد فترات عمل مسجلة" : "غير متاحة في بيانات الحالة القديمة"}</dd></div>
              <div><dt>نوع الإثبات</dt><dd>{current.firstStoreProofType ? proofTypeLabels[current.firstStoreProofType] ?? "وثيقة نشاط" : "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>رقم الإثبات</dt><dd>{requestedProof ? <bdi dir="auto">{requestedProof.proofNumber}</bdi> : <><button type="button" className="button button-secondary" disabled={proofDetailsLoading} onClick={() => void readProofDetails()}>{proofDetailsLoading ? "جارٍ قراءة رقم الإثبات…" : requestedProofError ? "إعادة قراءة رقم الإثبات" : "عرض رقم الإثبات عند الحاجة"}</button>{requestedProofError ? <span role="alert">{requestedProofError}</span> : null}</>}</dd></div>
              <div><dt>طريقة التوصيل</dt><dd>{current.firstStoreFulfillmentModes.map((mode) => fulfillmentModeOptions.find((option) => option.value === mode)?.label ?? mode).join("، ") || "غير متاحة في بيانات الحالة القديمة"}</dd></div>
              <div><dt>ملاحظات</dt><dd>{current.firstStoreNotes === undefined ? "غير متاحة في بيانات الحالة القديمة" : current.firstStoreNotes?.trim() || "لا توجد ملاحظات"}</dd></div>
              <div><dt>مصدر الحالة</dt><dd>{current.origin === "field" ? "تطبيق الميداني" : current.origin === "self_service" ? "التسجيل الذاتي الموثق" : "لوحة التحكم"}</dd></div>
              <div><dt>فترة التسوية</dt><dd>{current.settlementPeriod ? settlementPeriodLabel(current.settlementPeriod) : "لم تُثبت بعد"}</dd></div>
              <div><dt>شروط السياسة</dt><dd>{current.termsPolicyVersion ? <details><summary>مرجع السياسة المعتمدة</summary><bdi dir="ltr">{current.termsPolicyVersion}</bdi></details> : "لم تُربط بعد"}</dd></div>
              <div><dt>الحالة المالية</dt><dd>{financialProfileStateLabel(current.financialProfileState)}</dd></div>
            </dl>
            {current.reviewPhotoUploaded ? <p><a className="button button-secondary" href={`/api/partners/joining-cases/${encodeURIComponent(caseId)}/review-photo`} target="_blank" rel="noreferrer">عرض صورة المتجر الداخلية للمراجعة</a></p> : null}
            {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          </details>
          <section id="joining-case-actions" className="partner-case-actions" aria-labelledby="joining-case-actions-heading">
            <h3 id="joining-case-actions-heading">الخطوة التالية والإجراءات</h3>
            {(current.origin === "control_panel" || current.origin === "self_service") && !current.originatingFieldActorId && !storeId && ["draft", "submitted", "needs_correction"].includes(current.state) ? <PartnerCaseFieldAttribution caseId={caseId} serviceCityId={current.serviceCityId ?? ""} version={current.version} origin={current.origin === "self_service" ? "self_service" : "control_panel"} onUpdated={() => void readCase(false)} /> : null}
            {current.state === "draft" && current.origin === "field" ? <p>يستكمل الميداني الملف ثم يطلب قبول المشغّل؛ لا يُنشأ دور الشريك من تطبيق الميداني.</p> : null}
            {(current.state === "draft" || (current.state === "approved" && Boolean(current.store?.id))) ? <details className="partner-case-attachments">
              <summary>إدارة شعار المتجر وغلافه ومصدر الصور</summary>
              <>
                {current.storeProfileImage ? <p>يوجد شعار محفوظ.</p> : <p>الشعار مطلوب قبل نشر المتجر.</p>}
                {current.storeCoverImage ? <p>يوجد غلاف محفوظ.</p> : <p>غلاف المتجر مطلوب قبل النشر.</p>}
                <label className="field-label" htmlFor="joining-storefront-file">شعار المتجر<input id="joining-storefront-file" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setStoreImageFile(event.target.files?.[0] ?? null)} /></label>
                {storeImageFile ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void uploadIntakeImage("primary")}>رفع شعار المتجر</button> : null}
                <label className="field-label" htmlFor="joining-store-cover-file">غلاف واجهة المتجر<input id="joining-store-cover-file" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setStoreCoverFile(event.target.files?.[0] ?? null)} /></label>
                {storeCoverFile ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void uploadIntakeImage("cover")}>رفع غلاف المتجر</button> : null}
                <label className="field-label" htmlFor="joining-storefront-creator">منشئ الصورة<input id="joining-storefront-creator" disabled={busy} value={storeImageProvenance.creator} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, creator: event.target.value }))} /></label>
                <label className="field-label" htmlFor="joining-storefront-source">مصدر الصورة<input id="joining-storefront-source" disabled={busy} value={storeImageProvenance.sourceDescription} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, sourceDescription: event.target.value }))} /></label>
                <label className="field-label" htmlFor="joining-storefront-rights">حق الاستخدام<input id="joining-storefront-rights" disabled={busy} value={storeImageProvenance.rightsStatement} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, rightsStatement: event.target.value }))} /></label>
                <label className="action-row"><input type="checkbox" disabled={busy} checked={storeImageProvenance.rightsAttested} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, rightsAttested: event.target.checked }))} /> أؤكد صحة مصدر الصورة وحق استخدامه</label>
              </>
            </details> : null}
            {current.state === "draft" && canOperatorAdmitJoiningCase(current.origin, current.state) ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>{current.origin === "self_service" ? "قبول طلب التسجيل الذاتي وإنشاء دور الشريك" : "إرسال الحالة للمراجعة وإنشاء دور الشريك"}</button> : null}
            {current.state === "admission_requested" && current.origin === "field" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>قبول الإحالة وإنشاء دور الشريك</button> : null}
            {current.state === "submitted" ? <>
               <p className="managed-status managed-status-info">يستطيع قسم الشركاء اعتماد الانضمام وإنشاء المتجر الآن. يبقى الملف المالي غير مفعل حتى تربط المالية سياسة التسوية، ثم يقبل الشريك اتفاق عمولة المتجر وتوافق المالية عليه قبل النشر.</p>
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<TextArea className="resize-none" id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void reviewCase("approved")}>اعتماد الانضمام وإنشاء المتجر (دون تفعيل مالي)</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </> : null}
            {current.state === "needs_correction" ? <p>الحالة بانتظار تصحيح بيانات الشريك عبر المسار القانوني المتاح.</p> : null}
            {current.state === "approved" ? <>
              <p>تم اعتماد الانضمام. يُستكمل تفعيل الحساب من تطبيق الشريك، وتُدار جاهزية المتجر ونشره من ملف المتجر؛ الاعتماد لا يعني النشر للعملاء.</p>
              {storeId ? <StoreZeroCommissionProposal storeId={storeId} modes={current.store?.fulfillmentModes ?? current.firstStoreFulfillmentModes} /> : null}
              <details className="partner-case-attachments"><summary>إرشادات تفعيل حساب الشريك</summary><p>يفتح صاحب المتجر تطبيق الشريك برقم الجوال المسجّل. عند أول تفعيل يختار «أول دخول»؛ وإن سبق التفعيل يسجّل الدخول أو يستعيد كلمة المرور. لا يحتاج إلى دعوة من تطبيق الميداني.</p></details>
              {current.financialProfileState === "REQUIRED" ? <>
                <p className="managed-status managed-status-warning" role="status">{canManageFinancialTerms ? (activeTermsPolicy ? "اربط شروط التسوية المعتمدة لإكمال تفعيل الملف المالي." : policyReadMessage || "يلزم وجود سياسة مالية نشطة.") : "الملف بانتظار إجراء مستقل من مشغّل لديه صلاحية المالية وسياسات المنصة."}</p>
                {canManageFinancialTerms && !activeTermsPolicy ? <><Link className="button button-secondary" href="/policies?policy=partner-financial-terms&action=manage">فتح سياسة الشريك المالية</Link><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readFinancialTermsPolicy()}>إعادة قراءة السياسة النشطة</button></> : null}
                <button type="button" className="button button-primary" disabled={busy || !canManageFinancialTerms || !activeTermsPolicy} onClick={() => void bindFinancialTerms()}>استكمال الربط المالي وفق السياسة النشطة</button>
              </> : null}
            </> : null}
          </section>
        </>
      )}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      {embedded ? null : <div className="button-row"><Link className="button button-secondary" href="/partners?kind=joining">العودة إلى طلبات الانضمام</Link></div>}
    </section>
  );
}
