"use client";

import { type CommerceVertical, financialProfileStateLabel, type JoiningCaseResponse, joiningCaseStateLabel, type PartnerFinancialTermsPolicy, type ServiceCity, type StoreFulfillmentMode, settlementPeriodLabel } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerErrorMessage } from "./partner-error-message";
import { partnerMutationHeaders } from "./partner-request";
import { useSession } from "../../session/session-provider";

const fulfillmentModeOptions: ReadonlyArray<Readonly<{ value: StoreFulfillmentMode; label: string; description: string }>> = [
  { value: "BTHWANI_CAPTAIN", label: "توصيل بثواني", description: "المنصة تتولى إسناد التوصيل وإدارته." },
  { value: "PARTNER_CAPTAIN", label: "توصيل المتجر", description: "المتجر يعيّن كابتنًا نشطًا من كباتن متجره." },
  { value: "CUSTOMER_PICKUP", label: "استلم بنفسك من المتجر", description: "يذهب العميل إلى المتجر لاستلام الطلب." },
];

export function JoiningCaseDetail({ caseId }: { caseId: string }) {
  const { state: sessionState } = useSession();
  const canManageFinancialTerms = sessionState.kind === "authenticated" && sessionState.identity.permissions?.includes("finance") === true && sessionState.identity.permissions?.includes("platform_policies") === true;
  const [result, setResult] = useState<JoiningCaseResponse | null>(null);
  const [activeTermsPolicy, setActiveTermsPolicy] = useState<PartnerFinancialTermsPolicy | null>(null);
  const [policyReadMessage, setPolicyReadMessage] = useState("");
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
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

  const readFinancialTermsPolicy = useCallback(async () => {
    if (!canManageFinancialTerms) {
      setActiveTermsPolicy(null);
      setPolicyReadMessage("يتطلب اعتماد الشروط صلاحية Finance وسياسات المنصة؛ اطلب منح الصلاحيتين للمشغّل.");
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
  }, [readCase, readOptions, readFinancialTermsPolicy]);

  async function reconcileMutationError(response: Response, fallback: string, refreshPolicy = false) {
    const message = await partnerErrorMessage(response);
    await Promise.all([readCase(false), ...(refreshPolicy ? [readFinancialTermsPolicy()] : [])]);
    setError(message || fallback);
  }

  async function submitCase() {
    const current = result?.case;
    if (current?.state !== "draft" || current.origin !== "control_panel") return;
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
    if (decision === "approved" && (!canManageFinancialTerms || !activeTermsPolicy)) {
      setError(policyReadMessage || "لا توجد سياسة مالية نشطة أو لا تملك صلاحية Finance.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/partners/joining-cases/${encodeURIComponent(caseId)}/review`, {
        method: "POST",
        headers: partnerMutationHeaders(),
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
        headers: partnerMutationHeaders(),
        body: JSON.stringify({ expectedVersion: current.version, expectedTermsPolicyVersion: activeTermsPolicy.policyVersion }),
      });
      if (!response.ok) {
        await reconcileMutationError(response, "تعذر استكمال الربط المالي.", true);
        return;
      }
      setResult(await response.json() as JoiningCaseResponse);
    } catch {
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
              <div><dt>الفئة الرئيسية</dt><dd>{verticalName}</dd></div>
              <div><dt>أوضاع الطلب المختارة عند الانضمام</dt><dd>{current.firstStoreFulfillmentModes.map((mode) => fulfillmentModeOptions.find((option) => option.value === mode)?.label ?? mode).join("، ") || "لا توجد أوضاع مثبتة"}</dd></div>
              <div><dt>خط العرض</dt><dd dir="ltr">{current.firstStoreLatitude ?? "غير مسجل"}</dd></div>
              <div><dt>خط الطول</dt><dd dir="ltr">{current.firstStoreLongitude ?? "غير مسجل"}</dd></div>
              <div><dt>مصدر الحالة</dt><dd>{current.origin === "field" ? "تطبيق الميداني" : "لوحة التحكم"}</dd></div>
              <div><dt>عمولة المنصة</dt><dd>{current.commissionRateBps === null || current.commissionRateBps === undefined ? "لم تُثبت بعد" : `${(current.commissionRateBps / 100).toFixed(2)}%`}</dd></div>
              <div><dt>فترة التسوية</dt><dd>{current.settlementPeriod ? settlementPeriodLabel(current.settlementPeriod) : "لم تُثبت بعد"}</dd></div>
              <div><dt>إصدار شروط السياسة</dt><dd>{current.termsPolicyVersion ?? "لم يُربط بعد"}</dd></div>
              <div><dt>الحالة المالية</dt><dd>{financialProfileStateLabel(current.financialProfileState)}</dd></div>
            </dl>
            {current.storeProfileImage?.uri ? <figure className="mt-4 overflow-hidden rounded-xl border border-slate-200"><img src={current.storeProfileImage.uri} alt={`صورة متجر ${current.firstStoreName}`} className="h-48 w-full object-cover" /><figcaption className="p-2 text-sm text-slate-600">صورة المتجر المرفوعة من الميداني</figcaption></figure> : <p className="muted">لم تُرفع صورة متجر لهذا الملف بعد.</p>}
            {current.correctionReason ? <p role="alert">سبب التصحيح: {current.correctionReason}</p> : null}
          </div>
          <div className="managed-status managed-status-info">
            <strong>العمليات المتاحة</strong>
            {current.state === "draft" && current.origin === "field" ? <p>المسودة قيد استكمال تطبيق الميداني، وهو المسار الوحيد المسموح بإرسالها للمراجعة.</p> : null}
            {current.state === "draft" && current.origin === "control_panel" ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void submitCase()}>إرسال للمراجعة</button> : null}
            {current.state === "submitted" ? <>
              {activeTermsPolicy ? <p className="managed-status managed-status-info">سيُعتمد إصدار السياسة {activeTermsPolicy.policyVersion}: عمولة {(activeTermsPolicy.commissionRateBps / 100).toFixed(2)}%، وتسوية {settlementPeriodLabel(activeTermsPolicy.settlementPeriod)}.</p> : <><p className="managed-status managed-status-warning" role="status">{policyReadMessage || "تُقرأ العمولة وفترة التسوية من قسم السياسات ولا تُدخلان في ملف الانضمام."}</p><Link className="button button-secondary" href="/policies/partner-financial-terms">فتح سياسة الشريك المالية</Link><button type="button" className="button button-secondary" disabled={busy} onClick={() => void readFinancialTermsPolicy()}>إعادة قراءة السياسة النشطة</button></>}
              <label className="field-label" htmlFor="joining-correction">سبب التصحيح عند الحاجة<textarea className="resize-none" id="joining-correction" disabled={busy} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={busy || !canManageFinancialTerms || !activeTermsPolicy} onClick={() => void reviewCase("approved")}>اعتماد الحالة وإنشاء المتجر بالشروط النشطة</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void reviewCase("needs_correction")}>إعادة للتصحيح</button>
            </> : null}
            {current.state === "needs_correction" ? <p>الحالة بانتظار تصحيح بيانات الشريك عبر المسار القانوني المتاح.</p> : null}
            {current.state === "approved" ? <>
              <p>تم اعتماد الحالة. تُستخدم نسخة الشروط المثبتة في الملف، ولا يؤدي تغيير السياسة النشطة إلى تعديل ملف معتمد سابقًا.</p>
              {current.financialProfileState === "REQUIRED" ? <>
                <p className="managed-status managed-status-warning" role="status">{activeTermsPolicy ? "سيُربط الإصدار " + activeTermsPolicy.policyVersion + " بهذه الحالة العالقة." : policyReadMessage || "يلزم وجود سياسة مالية نشطة وصلاحية Finance."}</p>
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
