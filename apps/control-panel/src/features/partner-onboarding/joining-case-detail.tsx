"use client";
import { TextArea } from "@bthwani/design-system/web";

import { type CommercialStoreType, type CommerceVertical, financialProfileStateLabel, type JoiningCaseProofDetailsResponse, type JoiningCaseProofType, type JoiningCaseResponse, joiningCaseStateLabel, type MediaProvenanceInput, type PartnerFinancialTermsPolicy, type ServiceCity, type StoreFulfillmentMode, settlementPeriodLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { stablePartnerMutationHeaders } from "./partner-request";
import { useSession } from "../../session/session-provider";

const fulfillmentModeOptions: ReadonlyArray<Readonly<{ value: StoreFulfillmentMode; label: string; description: string }>> = [
  { value: "BTHWANI_CAPTAIN", label: "توصيل بثواني", description: "المنصة تتولى إسناد التوصيل وإدارته." },
  { value: "PARTNER_CAPTAIN", label: "توصيل المتجر", description: "المتجر يعيّن كابتنًا نشطًا من كباتن متجره." },
  { value: "CUSTOMER_PICKUP", label: "استلم بنفسك من المتجر", description: "يذهب العميل إلى المتجر لاستلام الطلب." },
];

const proofTypeLabels: Record<JoiningCaseProofType, string> = {
  COMMERCIAL_REGISTRATION: "سجل تجاري",
  IDENTITY_DOCUMENT: "هوية",
  FREELANCE_WORK_DOCUMENT: "وثيقة عمل حر",
};

const weekdays = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"] as const;

export function JoiningCaseDetail({ caseId }: { caseId: string }) {
  const { state: sessionState } = useSession();
  const canManageFinancialTerms = sessionState.kind === "authenticated" && sessionState.identity.permissions?.includes("finance") === true && sessionState.identity.permissions?.includes("platform_policies") === true;
  const [result, setResult] = useState<JoiningCaseResponse | null>(null);
  const [proofDetails, setProofDetails] = useState<JoiningCaseProofDetailsResponse | null>(null);
  const [proofDetailsError, setProofDetailsError] = useState("");
  const [proofImageFile, setProofImageFile] = useState<File | null>(null);
  const [storeImageFile, setStoreImageFile] = useState<File | null>(null);
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
    setProofDetailsError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/proof-details`, { cache: "no-store" });
      if (!response.ok) throw new Error("JOINING_CASE_PROOF_DETAILS_UNAVAILABLE");
      setProofDetails(await response.json() as JoiningCaseProofDetailsResponse);
    } catch {
      setProofDetails(null);
      setProofDetailsError("تعذر قراءة بيانات الإثبات الخاصة بصلاحية المشغّل.");
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
    void readFinancialTermsPolicy();
    void readProofDetails();
  }, [readCase, readOptions, readFinancialTermsPolicy, readProofDetails]);

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

  async function uploadIntakeImage(kind: "proof" | "store") {
    const current = result?.case;
    const file = kind === "proof" ? proofImageFile : storeImageFile;
    if (!current || current.state !== "draft" || !file || busy) return;
    if (kind === "store" && (storeImageProvenance.creator.trim().length < 2 || storeImageProvenance.sourceDescription.trim().length < 3 || storeImageProvenance.rightsStatement.trim().length < 5 || !storeImageProvenance.rightsAttested)) {
      setError("أكمل منشئ صورة الواجهة ومصدرها وبيان حق استخدامها، وأكّد صحة التصريح.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const headers = new Headers(await stablePartnerMutationHeaders(`joining-case-${kind}-image:${caseId}:${current.version}:${file.name}:${file.size}:${file.lastModified}`));
      headers.delete("Content-Type");
      headers.set("X-Expected-Version", String(current.version));
      const form = new FormData();
      form.append("file", file, file.name);
      if (kind === "store") {
        form.set("creator", storeImageProvenance.creator);
        form.set("sourceDescription", storeImageProvenance.sourceDescription);
        form.set("sourceUri", storeImageProvenance.sourceUri ?? "");
        form.set("rightsStatement", storeImageProvenance.rightsStatement);
        form.set("rightsUri", storeImageProvenance.rightsUri ?? "");
        form.set("rightsAttested", String(storeImageProvenance.rightsAttested));
      }
      const suffix = kind === "proof" ? "proof-image" : "store-image";
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/${suffix}`, { method: "POST", headers, body: form });
      if (!response.ok) {
        await reconcileMutationError(response, kind === "proof" ? "تعذر رفع صورة الإثبات الخاصة." : "تعذر رفع صورة واجهة المتجر.");
        return;
      }
      const updated = await response.json() as JoiningCaseResponse;
      setResult(updated);
      if (kind === "proof") {
        setProofImageFile(null);
        await readProofDetails();
      } else {
        setStoreImageFile(null);
      }
    } catch {
      await readCase(false);
      if (kind === "proof") await readProofDetails();
      setError("تعذر تأكيد رفع الصورة. أُعيدت قراءة الحالة؛ تحقق من حالة الملف قبل تكرار الرفع.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCase() {
    const current = result?.case;
    const canAdmit = current && ((current.origin === "control_panel" && current.state === "draft") || (current.origin === "field" && current.state === "admission_requested"));
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
    if (decision === "approved" && (!canManageFinancialTerms || !activeTermsPolicy)) {
      setError(policyReadMessage || "لا توجد سياسة مالية نشطة أو لا تملك صلاحية المالية.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/review`, {
        method: "POST",
        headers: await stablePartnerMutationHeaders(`joining-case-review:${caseId}:${current.version}:${decision}:${correctionReason.trim()}:${decision === "approved" ? activeTermsPolicy?.policyVersion ?? "" : ""}`),
        body: JSON.stringify({
          expectedVersion: current.version,
          decision,
          ...(decision === "approved" && activeTermsPolicy ? { expectedTermsPolicyVersion: activeTermsPolicy.policyVersion } : {}),
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
  const storeId = current?.store?.id;
  const cityName = current?.serviceCityId ? cities.find((city) => city.id === current.serviceCityId)?.displayNameAr ?? "غير متاحة في القراءة الحالية" : "غير محددة";
  const verticalName = current?.firstStoreVerticalId ? verticals.find((vertical) => vertical.id === current.firstStoreVerticalId)?.nameAr ?? "غير متاح في القراءة الحالية" : "غير محدد";
  const commercialTypeName = current?.firstStoreCommercialTypeId
    ? commercialTypes.find((type) => type.id === current.firstStoreCommercialTypeId)?.nameAr ?? current.firstStoreCommercialTypeId
    : "غير متاح في بيانات الحالة القديمة";
  return (
    <section className="access-card" aria-labelledby="joining-case-detail-title">
      <div className="access-card-heading">
        <span className="step-chip">المورد: تفاصيل حالة الانضمام</span>
        <p className="eyebrow">مراجعة الحالة المعتمدة</p>
        <h2 id="joining-case-detail-title">تفاصيل حالة انضمام الشريك</h2>
        <p className="muted">كل عملية تستخدم نسخة الحالة المقروءة وتعيد القراءة بعد التعارض أو الرفض .</p>
      </div>
      {!current ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر العثور على الحالة</strong><p>{error || "الحالة غير متاحة."}</p><button type="button" className="button button-secondary" onClick={() => void readCase()}>إعادة القراءة</button></div> : (
        <>
          <div className="managed-status managed-status-info" role="status">
            <strong>الحالة: {joiningCaseStateLabel(current.state)}</strong>
            <dl>
              <div><dt>اسم المالك</dt><dd>{current.ownerFullName || "غير مسجل في هذه الحالة"}</dd></div>
              <div><dt>رقم جوال المالك</dt><dd dir="ltr">{current.contactPhoneE164 || "غير مسجل"}</dd></div>
              <div><dt>اسم النشاط</dt><dd>{current.businessName || "غير مسجل"}</dd></div>
              <div><dt>اسم المتجر</dt><dd>{current.firstStoreName || "غير مسجل"}</dd></div>
              <div><dt>مدينة الخدمة</dt><dd>{cityName}</dd></div>
              <div><dt>العنوان</dt><dd>{current.firstStoreAddress || "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>النشاط الرئيسي</dt><dd>{verticalName}</dd></div>
              <div><dt>نوع المتجر</dt><dd>{commercialTypeName}</dd></div>
              <div><dt>موقع المتجر على الخريطة</dt><dd dir="ltr">{current.firstStoreLatitude != null && current.firstStoreLongitude != null ? `${current.firstStoreLatitude}, ${current.firstStoreLongitude}` : "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>ساعات العمل</dt><dd>{current.firstStoreWorkingHours ? current.firstStoreWorkingHours.intervals.length > 0 ? <ul>{current.firstStoreWorkingHours.intervals.map((interval) => <li key={`${interval.dayOfWeek}-${interval.opensAt}-${interval.closesAt}`}>{weekdays[interval.dayOfWeek - 1] ?? `اليوم ${interval.dayOfWeek}`}: {interval.opensAt}–{interval.closesAt}{interval.closesNextDay ? " (اليوم التالي)" : ""}</li>)}</ul> : "لا توجد فترات عمل مسجلة" : "غير متاحة في بيانات الحالة القديمة"}</dd></div>
              <div><dt>نوع الإثبات</dt><dd>{current.firstStoreProofType ? proofTypeLabels[current.firstStoreProofType] ?? "وثيقة نشاط" : "غير متاح في بيانات الحالة القديمة"}</dd></div>
              <div><dt>رقم الإثبات</dt><dd>{proofDetails?.proofNumber ?? (proofDetailsError || "جارٍ قراءة الرقم من السجل الخاص…")}</dd></div>
              <div><dt>صورة الإثبات</dt><dd>{typeof current.firstStoreProofImageUploaded === "boolean" ? current.firstStoreProofImageUploaded ? "تم رفع صورة الإثبات؛ لا يُعرض ملف الإثبات الخاص في هذه الشاشة." : "لم تُرفع صورة إثبات لهذا الملف." : "حالة صورة الإثبات غير متاحة في بيانات الحالة القديمة"}</dd></div>
              <div><dt>طريقة التوصيل</dt><dd>{current.firstStoreFulfillmentModes.map((mode) => fulfillmentModeOptions.find((option) => option.value === mode)?.label ?? mode).join("، ") || "غير متاحة في بيانات الحالة القديمة"}</dd></div>
              <div><dt>ملاحظات</dt><dd>{current.firstStoreNotes === undefined ? "غير متاحة في بيانات الحالة القديمة" : current.firstStoreNotes?.trim() || "لا توجد ملاحظات"}</dd></div>
              <div><dt>مصدر الحالة</dt><dd>{current.origin === "field" ? "تطبيق الميداني" : "لوحة التحكم"}</dd></div>
              <div><dt>فترة التسوية</dt><dd>{current.settlementPeriod ? settlementPeriodLabel(current.settlementPeriod) : "لم تُثبت بعد"}</dd></div>
              <div><dt>إصدار شروط السياسة</dt><dd>{current.termsPolicyVersion ?? "لم يُربط بعد"}</dd></div>
              <div><dt>الحالة المالية</dt><dd>{financialProfileStateLabel(current.financialProfileState)}</dd></div>
            </dl>
            {current.storeProfileImage?.uri ? <figure className="mt-4 overflow-hidden rounded-xl border border-slate-200"><img src={current.storeProfileImage.uri} alt={`صورة واجهة متجر ${current.firstStoreName}`} className="h-48 w-full object-cover" /><figcaption className="p-2 text-sm text-slate-600">صورة واجهة المتجر المرفوعة من الميداني</figcaption></figure> : <p className="muted">لم تُرفع صورة واجهة متجر لهذا الملف بعد.</p>}
            {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          </div>
          <div className="managed-status managed-status-info">
            <strong>العمليات المتاحة</strong>
            {current.state === "draft" && current.origin === "field" ? <p>يستكمل الميداني الملف ثم يطلب قبول المشغّل؛ لا يُنشأ دور الشريك من تطبيق الميداني.</p> : null}
            {current.state === "draft" ? <div className="managed-status managed-status-info">
              <strong>مرفقات ملف الانضمام</strong>
              {!current.storeProfileImage ? <>
                <p>ارفع صورة واجهة المتجر. هذه الصورة مخصّصة للعرض وتختلف عن صورة الإثبات الخاصة.</p>
                <label className="field-label" htmlFor="joining-storefront-file">صورة واجهة المتجر<input id="joining-storefront-file" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setStoreImageFile(event.target.files?.[0] ?? null)} /></label>
                <label className="field-label" htmlFor="joining-storefront-creator">منشئ الصورة<input id="joining-storefront-creator" disabled={busy} value={storeImageProvenance.creator} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, creator: event.target.value }))} /></label>
                <label className="field-label" htmlFor="joining-storefront-source">مصدر الصورة<input id="joining-storefront-source" disabled={busy} value={storeImageProvenance.sourceDescription} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, sourceDescription: event.target.value }))} /></label>
                <label className="field-label" htmlFor="joining-storefront-rights">حق الاستخدام<input id="joining-storefront-rights" disabled={busy} value={storeImageProvenance.rightsStatement} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, rightsStatement: event.target.value }))} /></label>
                <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={storeImageProvenance.rightsAttested} onChange={(event) => setStoreImageProvenance((currentValue) => ({ ...currentValue, rightsAttested: event.target.checked }))} /> أؤكد صحة مصدر الصورة وحق استخدامه</label>
                {storeImageFile ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void uploadIntakeImage("store")}>رفع صورة واجهة المتجر</button> : null}
              </> : <p>صورة واجهة المتجر مرفوعة.</p>}
              {!current.firstStoreProofImageUploaded ? <>
                <p>ارفع صورة الإثبات بعد اختيار JPG أو PNG. تُخزّن الصورة مشفّرة ولا تُعرض كرابط عام.</p>
                <label className="field-label" htmlFor="joining-proof-file">صورة الإثبات الخاصة<input id="joining-proof-file" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setProofImageFile(event.target.files?.[0] ?? null)} /></label>
                {proofImageFile ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void uploadIntakeImage("proof")}>رفع صورة الإثبات المشفّرة</button> : null}
              </> : <p>صورة الإثبات الخاصة مرفوعة ومحمية بالتشفير.</p>}
              {proofDetailsError ? <p role="alert">{proofDetailsError}</p> : null}
              {proofDetails?.proofImageUploaded ? <a className="button button-secondary" href={`/api/partners/joining-cases/${encodeURIComponent(caseId)}/proof-image`} rel="noreferrer" target="_blank">تنزيل صورة الإثبات للمراجعة المصرّح بها</a> : null}
            </div> : null}
            {current.state === "draft" && current.origin === "control_panel" ? <button type="button" className="button button-primary" disabled={busy || !current.storeProfileImage || !current.firstStoreProofImageUploaded} onClick={() => void submitCase()}>إرسال الحالة للمراجعة وإنشاء دور الشريك</button> : null}
            {current.state === "admission_requested" && current.origin === "field" ? <button type="button" className="button button-primary" disabled={busy || !current.storeProfileImage || !current.firstStoreProofImageUploaded} onClick={() => void submitCase()}>قبول الإحالة وإنشاء دور الشريك</button> : null}
            {current.state === "submitted" ? <>
               {activeTermsPolicy ? <p className="managed-status managed-status-info">ستُعتمد شروط التسوية: {settlementPeriodLabel(activeTermsPolicy.settlementPeriod)}.</p> : <><output className="managed-status managed-status-warning">{policyReadMessage || "تُقرأ فترة التسوية من قسم السياسات؛ أما عمولة كل متجر فتُحسم في اتفاقيته الخاصة بعد تفاوض المالك وموافقة المالية."}</output><Link className="button button-secondary" href="/policies/partner-financial-terms">فتح شروط تسوية الشريك</Link><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readFinancialTermsPolicy()}>إعادة قراءة الشروط النشطة</button></>}
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<TextArea className="resize-none" id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy || !canManageFinancialTerms || !activeTermsPolicy} onClick={() => void reviewCase("approved")}>اعتماد الحالة وإنشاء المتجر بالشروط النشطة</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </> : null}
            {current.state === "needs_correction" ? <p>الحالة بانتظار تصحيح بيانات الشريك عبر المسار القانوني المتاح.</p> : null}
            {current.state === "approved" ? <>
              <p>تم اعتماد الحالة. تُستخدم نسخة الشروط المثبتة في الملف، ولا يؤدي تغيير السياسة النشطة إلى تعديل ملف معتمد سابقًا.</p>
              {current.financialProfileState === "REQUIRED" ? <>
                <p className="managed-status managed-status-warning" role="status">{activeTermsPolicy ? "ستُربط شروط التسوية بهذه الحالة العالقة." : policyReadMessage || "يلزم وجود سياسة مالية نشطة وصلاحية المالية."}</p>
                {!activeTermsPolicy ? <><Link className="button button-secondary" href="/policies/partner-financial-terms">فتح سياسة الشريك المالية</Link><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readFinancialTermsPolicy()}>إعادة قراءة السياسة النشطة</button></> : null}
                <button type="button" className="button button-primary" disabled={busy || !canManageFinancialTerms || !activeTermsPolicy} onClick={() => void bindFinancialTerms()}>استكمال الربط المالي وفق السياسة النشطة</button>
              </> : null}
            </> : null}
          </div>
          {storeId ? <div className="managed-status managed-status-info"><strong>ملف المتجر</strong><p>تُدار حالة نشر المتجر وأوضاع التنفيذ من مساحة المتجر الموحدة.</p><Link className="button button-secondary" href={`/partners/stores/${encodeURIComponent(storeId)}`}>فتح ملف المتجر</Link></div> : null}
        </>
      )}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      <div className="button-row"><Link className="button button-secondary" href="/partners">العودة إلى طابور الحالات</Link><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readCase()}>إعادة قراءة الحالة</button></div>
    </section>
  );
}
