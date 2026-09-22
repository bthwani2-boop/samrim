"use client";

import type { DiscoveryContentAnalytics, DiscoveryContentView, PromotionView, ServiceCity } from "@bthwani/dsh";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../../session/session-provider";
import { type MarketingResourceKey, workspaceMarketingResources } from "../../navigation/workspace-registry";

type ApiError = { error?: { message?: string } };

function apiMessage(value: unknown): string {
  return value && typeof value === "object" && "error" in value && (value as ApiError).error?.message ? String((value as ApiError).error?.message) : "تعذر تنفيذ العملية.";
}

function futureDateInput(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

function futureEndDateInput(): string {
  return new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

async function readActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  const response = await fetch("/api/service-cities", { cache: "no-store" });
  if (!response.ok) throw new Error("SERVICE_CITIES_READ_FAILED");
  const body = await response.json() as { cities?: ReadonlyArray<ServiceCity> };
  return (body.cities ?? []).filter((city) => city.active);
}

function resourceForPath(pathname: string): MarketingResourceKey {
  if (pathname === "/marketing") return "overview";
  return workspaceMarketingResources.find((resource) => resource.href !== "/marketing" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>التسويق للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p>
      </div>
    </section>
  );
}

export function MarketingWorkspace({ resource, children }: { resource: MarketingResourceKey; children: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname() ?? "/marketing";
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();

  const selected = workspaceMarketingResources.find((item) => item.key === activeResource) ?? workspaceMarketingResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="marketing-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة النمو</p>
        <h1 id="marketing-page-title">{selected.key === "overview" ? "التسويق والمحتوى" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      {children}
    </section>
  );
}

export function MarketingOverview() {
  return (
    <section className="access-card" aria-labelledby="marketing-overview-title">
      <div className="access-card-heading">
        <span className="step-chip">موارد مستقلة</span>
        <p className="eyebrow">نقطة البدء</p>
        <h2 id="marketing-overview-title">اختر مورد التسويق</h2>
        <p className="muted">العروض ومحتوى الاكتشاف يملكان مسارين مستقلين، ولكل مسار قراءة ونشر قانوني.</p>
      </div>
      <div className="workspace-resource-cards">
        {workspaceMarketingResources.slice(1).map((item) => (
          <Link className="access-card" href={item.href} key={item.key}>
            <span className="step-chip">مساحة عمل</span>
            <h3>{item.label}</h3>
            <p className="muted">{item.description}</p>
            <span className="button button-secondary">فتح المساحة</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MarketingPromotionsWorkspace() {
  const [promotions, setPromotions] = useState<ReadonlyArray<PromotionView>>([]);
  const [startsAt, setStartsAt] = useState(futureDateInput);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [promotionForm, setPromotionForm] = useState({ code: "", nameAr: "", descriptionAr: "", kind: "PERCENTAGE" as "PERCENTAGE" | "FIXED", valueMinor: "10", maxDiscountMinor: "", redemptionLimit: "", storeId: "", serviceCityId: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/marketing/promotions", { cache: "no-store" });
    if (!response.ok) throw new Error("MARKETING_PROMOTIONS_READ_FAILED");
    const body = await response.json() as { promotions?: ReadonlyArray<PromotionView> };
    setPromotions(body.promotions ?? []);
  }, []);

  useEffect(() => { void load().catch(() => setMessage("تعذر قراءة سجل العروض.")); }, [load]);
  useEffect(() => { void readActiveServiceCities().then(setCities).catch(() => setMessage("تعذر قراءة مدن الخدمة؛ يمكنك إنشاء العرض دون تقييد مدينة.")); }, []);

  async function createPromotion() {
    setBusy(true);
    setMessage("");
    try {
      const starts = new Date(startsAt);
      if (!promotionForm.code.trim() || !promotionForm.nameAr.trim() || !Number.isSafeInteger(Number(promotionForm.valueMinor)) || Number(promotionForm.valueMinor) <= 0 || Number.isNaN(starts.getTime())) throw new Error("أكمل بيانات العرض الأساسية.");
      const response = await fetch("/api/marketing/promotions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ id: `promotion-${crypto.randomUUID()}`, code: promotionForm.code, nameAr: promotionForm.nameAr, descriptionAr: promotionForm.descriptionAr, kind: promotionForm.kind, valueMinor: Number(promotionForm.valueMinor), fundingSource: "MERCHANT", startsAt: starts.toISOString(), ...(promotionForm.maxDiscountMinor ? { maxDiscountMinor: Number(promotionForm.maxDiscountMinor) } : {}), ...(promotionForm.redemptionLimit ? { redemptionLimit: Number(promotionForm.redemptionLimit) } : {}), ...(promotionForm.storeId.trim() ? { storeId: promotionForm.storeId.trim() } : {}), ...(promotionForm.serviceCityId ? { serviceCityId: promotionForm.serviceCityId } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      setPromotionForm({ code: "", nameAr: "", descriptionAr: "", kind: "PERCENTAGE", valueMinor: "10", maxDiscountMinor: "", redemptionLimit: "", storeId: "", serviceCityId: "" });
      await load();
      setMessage("تم إنشاء العرض كمسودة. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء العرض.");
    } finally {
      setBusy(false);
    }
  }

  async function publishPromotion(item: PromotionView, state: "PUBLISHED" | "PAUSED") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/marketing/promotions/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر العرض.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-resource-grid" data-testid="marketing-promotions-workspace">
      <section className="access-card">
        <div className="access-card-heading"><span className="step-chip">العروض</span><p className="eyebrow">تسويق مضبوط</p><h2>إنشاء عرض</h2><p className="muted">العرض يُنشأ كمسودة، ثم يُنشر بعد مراجعة النطاق والفترة.</p></div>
        <div className="workspace-form-grid">
          <input aria-label="رمز العرض" placeholder="WELCOME10" value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value }))} />
          <input aria-label="اسم العرض" placeholder="خصم العملاء الجدد" value={promotionForm.nameAr} onChange={(event) => setPromotionForm((current) => ({ ...current, nameAr: event.target.value }))} />
          <input aria-label="وصف العرض" placeholder="خصم على أول طلب" value={promotionForm.descriptionAr} onChange={(event) => setPromotionForm((current) => ({ ...current, descriptionAr: event.target.value }))} />
          <select aria-label="نوع العرض" value={promotionForm.kind} onChange={(event) => setPromotionForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="PERCENTAGE">نسبة مئوية</option><option value="FIXED">قيمة ثابتة</option></select>
          <input aria-label="قيمة العرض" inputMode="numeric" type="number" min="1" value={promotionForm.valueMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, valueMinor: event.target.value }))} />
          {promotionForm.kind === "PERCENTAGE" ? <input aria-label="الحد الأعلى للخصم" inputMode="numeric" type="number" min="1" placeholder="اختياري" value={promotionForm.maxDiscountMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, maxDiscountMinor: event.target.value }))} /> : null}
          <input aria-label="حد الاستخدام" inputMode="numeric" type="number" min="1" placeholder="اختياري" value={promotionForm.redemptionLimit} onChange={(event) => setPromotionForm((current) => ({ ...current, redemptionLimit: event.target.value }))} />
          <input aria-label="معرّف المتجر" placeholder="اختياري: تقييد العرض بمتجر" value={promotionForm.storeId} onChange={(event) => setPromotionForm((current) => ({ ...current, storeId: event.target.value }))} />
          <label className="field-label" htmlFor="promotion-city">مدينة الخدمة<select id="promotion-city" value={promotionForm.serviceCityId} onChange={(event) => setPromotionForm((current) => ({ ...current, serviceCityId: event.target.value }))}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <input aria-label="بداية العرض" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          <button className="button" type="button" disabled={busy} onClick={() => void createPromotion()}>إنشاء مسودة العرض</button>
        </div>
      </section>
      <section className="access-card" aria-labelledby="marketing-promotions-title">
        <div className="access-card-heading"><h2 id="marketing-promotions-title">سجل العروض</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        {promotions.length ? promotions.map((item) => <article className="access-card" key={item.id}><strong>{item.nameAr}</strong><p className="muted">{item.code} · {item.kind === "PERCENTAGE" ? `${item.valueMinor}%` : item.valueMinor} · {item.state}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void publishPromotion(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف العرض" : "نشر العرض"}</button></article>) : <p className="muted">لا توجد عروض بعد.</p>}
      </section>
    </div>
  );
}

export function MarketingContentWorkspace() {
  const [content, setContent] = useState<ReadonlyArray<DiscoveryContentView>>([]);
  const [analytics, setAnalytics] = useState<ReadonlyArray<DiscoveryContentAnalytics>>([]);
  const [contentStartsAt, setContentStartsAt] = useState(futureDateInput);
  const [contentEndsAt, setContentEndsAt] = useState(futureEndDateInput);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [contentForm, setContentForm] = useState({ titleAr: "", bodyAr: "", kind: "BANNER" as "BANNER" | "CAROUSEL" | "SHORT_FORM", targetType: "INFO" as "STORE" | "PRODUCT" | "CATEGORY" | "PROMOTION" | "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
  const [targetOptions, setTargetOptions] = useState<ReadonlyArray<{ id: string; label: string; detail?: string }>>([]);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const productSearch = contentForm.targetType === "PRODUCT" ? targetSearch.trim() : "";

  const load = useCallback(async () => {
    const response = await fetch("/api/marketing/content", { cache: "no-store" });
    if (!response.ok) throw new Error("MARKETING_CONTENT_READ_FAILED");
    const body = await response.json() as { items?: ReadonlyArray<DiscoveryContentView> };
    setContent(body.items ?? []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const response = await fetch("/api/marketing/analytics", { cache: "no-store" });
    if (!response.ok) throw new Error("MARKETING_ANALYTICS_READ_FAILED");
    const body = await response.json() as { items?: ReadonlyArray<DiscoveryContentAnalytics> };
    setAnalytics(body.items ?? []);
  }, []);

  useEffect(() => { void load().catch(() => setMessage("تعذر قراءة سجل محتوى الاكتشاف.")); }, [load]);
  useEffect(() => { void loadAnalytics().catch(() => setMessage("تعذر قراءة تحليلات المحتوى.")); }, [loadAnalytics]);
  useEffect(() => {
    if (!mediaPreviewUrl) return;
    return () => URL.revokeObjectURL(mediaPreviewUrl);
  }, [mediaPreviewUrl]);
  useEffect(() => { void readActiveServiceCities().then(setCities).catch(() => setMessage("تعذر قراءة مدن الخدمة؛ يمكنك نشر المحتوى على كل المدن.")); }, []);
  useEffect(() => {
    if (contentForm.targetType === "INFO") {
      setTargetOptions([]);
      setTargetMessage("");
      setTargetLoading(false);
      return;
    }
    if (contentForm.targetType === "STORE" && !contentForm.serviceCityId) {
      setTargetOptions([]);
      setTargetMessage("اختر مدينة الخدمة أولًا لعرض المتاجر المنشورة فيها.");
      setTargetLoading(false);
      return;
    }
    if (contentForm.targetType === "PRODUCT" && productSearch.length < 2) {
      setTargetOptions([]);
      setTargetMessage("اكتب حرفين على الأقل للبحث في المنتجات النشطة.");
      setTargetLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ targetType: contentForm.targetType });
    if (contentForm.serviceCityId) params.set("serviceCityId", contentForm.serviceCityId);
    if (contentForm.targetType === "PRODUCT") params.set("query", productSearch);
    setTargetLoading(true);
    setTargetMessage("");
    void fetch(`/api/marketing/content/targets?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { options?: ReadonlyArray<{ id: string; label: string; detail?: string }>; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر تحميل الوجهات.");
        setTargetOptions(body?.options ?? []);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setTargetOptions([]);
        setTargetMessage(error instanceof Error ? error.message : "تعذر تحميل الوجهات.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setTargetLoading(false);
      });
    return () => controller.abort();
  }, [contentForm.serviceCityId, contentForm.targetType, productSearch]);

  async function createContent() {
    setBusy(true);
    setMessage("");
    try {
      const starts = new Date(contentStartsAt);
      const ends = contentEndsAt ? new Date(contentEndsAt) : null;
      if (!contentForm.titleAr.trim() || Number.isNaN(starts.getTime()) || !Number.isSafeInteger(Number(contentForm.ordinal)) || Number(contentForm.ordinal) < 0) throw new Error("أكمل عنوان المحتوى وتاريخه وترتيبه.");
      if (!mediaFile) throw new Error("اختر صورة JPEG أو PNG للمحتوى.");
      if (mediaFile.size > 10 * 1024 * 1024) throw new Error("حجم الصورة يجب ألا يتجاوز 10 ميجابايت.");
      if (!["image/jpeg", "image/png"].includes(mediaFile.type.toLowerCase())) throw new Error("الصورة يجب أن تكون JPEG أو PNG.");
      if (contentForm.targetType !== "INFO" && !targetOptions.some((option) => option.id === contentForm.targetId)) throw new Error("اختر وجهة من نتائج DSH الحالية قبل إنشاء المحتوى.");
      if (ends && (Number.isNaN(ends.getTime()) || ends <= starts)) throw new Error("نهاية المحتوى يجب أن تكون بعد بدايته.");
      const form = new FormData();
      form.append("id", `content-${crypto.randomUUID()}`);
      form.append("kind", contentForm.kind);
      form.append("titleAr", contentForm.titleAr.trim());
      if (contentForm.bodyAr.trim()) form.append("bodyAr", contentForm.bodyAr.trim());
      form.append("targetType", contentForm.targetType);
      if (contentForm.targetId.trim()) form.append("targetId", contentForm.targetId.trim());
      if (contentForm.serviceCityId) form.append("serviceCityId", contentForm.serviceCityId);
      form.append("startsAt", starts.toISOString());
      if (ends) form.append("endsAt", ends.toISOString());
      form.append("ordinal", String(Number(contentForm.ordinal)));
      form.append("file", mediaFile, mediaFile.name);
      const response = await fetch("/api/marketing/content", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: String(content.length + 1) });
      setTargetSearch("");
      setMediaFile(null);
      setMediaPreviewUrl("");
      await load();
      await loadAnalytics();
      setMessage("تم إنشاء المحتوى كمسودة. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  async function publishContent(item: DiscoveryContentView, state: "PUBLISHED" | "PAUSED") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/marketing/content/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-resource-grid" data-testid="marketing-content-workspace">
      <section className="access-card">
        <div className="access-card-heading"><span className="step-chip">الاكتشاف</span><p className="eyebrow">محتوى منشور</p><h2>إنشاء بطاقة اكتشاف</h2><p className="muted">المحتوى العام لا يظهر إلا بعد نشره ومن خلال مسار DSH القانوني.</p></div>
        <div className="workspace-form-grid">
          <input aria-label="عنوان المحتوى" placeholder="مختارات الأسبوع" value={contentForm.titleAr} onChange={(event) => setContentForm((current) => ({ ...current, titleAr: event.target.value }))} />
          <input aria-label="نص المحتوى" placeholder="اكتشف الجديد في مدينتك" value={contentForm.bodyAr} onChange={(event) => setContentForm((current) => ({ ...current, bodyAr: event.target.value }))} />
          <label className="field-label" htmlFor="marketing-content-kind">نوع المحتوى<select id="marketing-content-kind" aria-label="نوع المحتوى" value={contentForm.kind} onChange={(event) => setContentForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="BANNER">بنر رئيسي</option><option value="CAROUSEL">شريحة كاروسيل</option><option value="SHORT_FORM">قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="marketing-content-media">صورة المحتوى<input id="marketing-content-media" aria-label="ملف صورة المحتوى" type="file" accept="image/jpeg,image/png" required onChange={(event) => { const file = event.target.files?.[0] ?? null; setMediaFile(file); setMediaPreviewUrl(file ? URL.createObjectURL(file) : ""); }} /></label>
          {mediaFile ? <p className="muted" data-testid="marketing-content-file">{mediaFile.name} · {(mediaFile.size / 1024).toFixed(0)} كيلوبايت</p> : <p className="muted">JPEG أو PNG، حتى 10 ميجابايت.</p>}
          {mediaPreviewUrl ? <div><p className="muted">معاينة تقريبية لاقتصاص الصورة في بطاقة الهاتف:</p><img className="workspace-discovery-preview" src={mediaPreviewUrl} alt="معاينة صورة محتوى الاكتشاف" /></div> : null}
          <label className="field-label" htmlFor="marketing-content-target">نوع الوجهة<select id="marketing-content-target" aria-label="نوع وجهة المحتوى" value={contentForm.targetType} onChange={(event) => { setTargetSearch(""); setTargetOptions([]); setContentForm((current) => ({ ...current, targetType: event.target.value as typeof current.targetType, targetId: "" })); }}><option value="INFO">معلومات فقط</option><option value="STORE">متجر</option><option value="PRODUCT">منتج</option><option value="CATEGORY">تصنيف</option><option value="PROMOTION">عرض</option></select></label>
          {contentForm.targetType !== "INFO" ? <>
            <input aria-label="بحث في الوجهات" placeholder={contentForm.targetType === "PRODUCT" ? "ابحث باسم المنتج" : "اكتب لتصفية الوجهات"} value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); if (contentForm.targetType === "PRODUCT") setContentForm((current) => ({ ...current, targetId: "" })); }} />
            <label className="field-label" htmlFor="marketing-content-target-option">الوجهة المعتمدة<select id="marketing-content-target-option" aria-label="الوجهة المعتمدة" value={contentForm.targetId} disabled={targetLoading || targetOptions.length === 0} onChange={(event) => setContentForm((current) => ({ ...current, targetId: event.target.value }))}>
              <option value="">{targetLoading ? "جارٍ تحميل الوجهات…" : "اختر وجهة من بيانات DSH"}</option>
              {targetOptions.filter((option) => contentForm.targetType === "PRODUCT" || !targetSearch.trim() || `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase().includes(targetSearch.trim().toLocaleLowerCase())).map((option) => <option key={option.id} value={option.id}>{option.detail ? `${option.label} · ${option.detail}` : option.label}</option>)}
            </select></label>
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}
            <p className="muted">تُختار الوجهة من السجلات المعتمدة، ويعيد DSH التحقق من صلاحيتها حسب المدينة ووقت العرض.</p>
          </> : null}
          <label className="field-label" htmlFor="marketing-content-city">مدينة الخدمة<select id="marketing-content-city" aria-label="مدينة خدمة المحتوى" value={contentForm.serviceCityId} onChange={(event) => { setTargetOptions([]); setContentForm((current) => ({ ...current, serviceCityId: event.target.value, targetId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <input aria-label="بداية المحتوى" type="datetime-local" value={contentStartsAt} onChange={(event) => setContentStartsAt(event.target.value)} />
          <input aria-label="نهاية المحتوى" type="datetime-local" value={contentEndsAt} onChange={(event) => setContentEndsAt(event.target.value)} />
          <input aria-label="ترتيب المحتوى" inputMode="numeric" type="number" min="0" value={contentForm.ordinal} onChange={(event) => setContentForm((current) => ({ ...current, ordinal: event.target.value }))} />
          <button className="button" type="button" disabled={busy} onClick={() => void createContent()}>إنشاء مسودة المحتوى</button>
        </div>
      </section>
      <section className="access-card" aria-labelledby="marketing-content-title">
        <div className="access-card-heading"><h2 id="marketing-content-title">سجل محتوى الاكتشاف</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        {content.length ? content.map((item) => {
          const counts = Object.fromEntries(analytics.filter((entry) => entry.contentId === item.id).map((entry) => [entry.eventType, entry.count]));
          return <article className="access-card" key={item.id}>{item.mediaUri ? <img className="workspace-media-preview" src={item.mediaUri} alt="" loading="lazy" /> : null}<strong>{item.titleAr}</strong><p className="muted">{item.kind} · {item.targetType} · {item.serviceCityId ? "مدينة محددة" : "كل المدن"} · ترتيب {item.ordinal} · {item.state}</p><p className="muted">الظهور {counts.IMPRESSION ?? 0} · النقر {counts.CLICK ?? 0} · التحويل {counts.CONVERSION ?? 0}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف المحتوى" : "نشر المحتوى"}</button></article>;
        }) : <p className="muted">لا يوجد محتوى بعد.</p>}
      </section>
    </div>
  );
}
