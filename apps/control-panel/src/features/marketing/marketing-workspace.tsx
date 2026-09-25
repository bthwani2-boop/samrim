"use client";

import type { DiscoveryContentAnalytics, DiscoveryContentView, OperatorDiscoveryContentRegistryResponse, OperatorPromotionRegistryResponse, PromotionView, ServiceCity } from "@bthwani/dsh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type MarketingResourceKey, workspaceMarketingResources } from "../../navigation/workspace-registry";
import { useSession } from "../../session/session-provider";
import { WorkspaceResourceIndex } from "../workspace/workspace-resource-index";
import styles from "./marketing-workspace.module.css";

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
    <WorkspaceResourceIndex
      title="موارد التسويق والمحتوى"
      description="العروض ومحتوى الاكتشاف مساران مستقلان، ولكل منهما قراءة ونشر من مالكه القانوني."
      resources={workspaceMarketingResources.slice(1)}
    />
  );
}

export function MarketingPromotionsWorkspace() {
  const [registry, setRegistry] = useState<OperatorPromotionRegistryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<"starts_desc" | "starts_asc">("starts_desc");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState(false);
  const [startsAt, setStartsAt] = useState(futureDateInput);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [promotionForm, setPromotionForm] = useState({ code: "", nameAr: "", descriptionAr: "", kind: "PERCENTAGE" as "PERCENTAGE" | "FIXED", valueMinor: "10", maxDiscountMinor: "", redemptionLimit: "", storeId: "", serviceCityId: "" });

  const load = useCallback(async (query: { search?: string; state?: string; sort?: "starts_desc" | "starts_asc"; cursor?: string } = {}) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/promotions?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as OperatorPromotionRegistryResponse | { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل العروض." : "تعذر قراءة سجل العروض.");
      setRegistry(body as OperatorPromotionRegistryResponse);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, cursor, sort, state]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض.")); }, [load]);
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
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setSort("starts_desc"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", sort: "starts_desc", cursor: "" });
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
    <div className={styles.workspace} data-testid="marketing-promotions-workspace">
      <details className="access-card">
        <summary className={styles.createSummary}>إنشاء عرض جديد</summary>
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
      </details>
      <section className="access-card" aria-labelledby="marketing-promotions-title">
        <div className="access-card-heading"><h2 id="marketing-promotions-title">سجل العروض</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="promotion-search">رمز العرض أو الاسم<input id="promotion-search" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="promotion-state">الحالة<select id="promotion-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option></select></label>
          <label className="field-label" htmlFor="promotion-sort">ترتيب البداية<select id="promotion-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="starts_desc">الأحدث بداية</option><option value="starts_asc">الأقدم بداية</option></select></label>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
          <button className="button button-quiet" type="button" onClick={() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض."))} disabled={loading}>{loading ? "جارٍ القراءة…" : "تحديث"}</button>
        </form>
        {registry?.promotions.length ? <div className="finance-table-wrap"><table className="finance-table"><caption className="visually-hidden">سجل العروض</caption><thead><tr><th scope="col">العرض</th><th scope="col">الرمز</th><th scope="col">النوع والقيمة</th><th scope="col">الحالة</th><th scope="col">بداية العرض</th><th scope="col">الإجراء</th></tr></thead><tbody>{registry.promotions.map((item) => <tr key={item.id}><th scope="row">{item.nameAr}<br /><bdi dir="ltr">{item.id}</bdi></th><td><bdi dir="ltr">{item.code}</bdi></td><td>{item.kind === "PERCENTAGE" ? `${item.valueMinor}%` : item.valueMinor}</td><td>{item.state}</td><td><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td><button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishPromotion(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف العرض" : "نشر العرض"}</button></td></tr>)}</tbody></table></div> : loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة العروض…</p> : <p className="collection-state">لا توجد عروض مطابقة.</p>}
        <nav className={styles.pagination} aria-label="صفحات سجل العروض"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
      </section>
    </div>
  );
}

export function MarketingContentWorkspace() {
  const [registry, setRegistry] = useState<OperatorDiscoveryContentRegistryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<"priority" | "created_desc">("priority");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState(false);
  const [analyticsContentId, setAnalyticsContentId] = useState("");
  const [analytics, setAnalytics] = useState<ReadonlyArray<DiscoveryContentAnalytics> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [contentStartsAt, setContentStartsAt] = useState(futureDateInput);
  const [contentEndsAt, setContentEndsAt] = useState(futureEndDateInput);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [contentForm, setContentForm] = useState({ titleAr: "", bodyAr: "", kind: "BANNER" as "BANNER" | "CAROUSEL" | "SHORT_FORM", targetType: "INFO" as "STORE" | "PRODUCT" | "CATEGORY" | "PROMOTION" | "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
  const [targetOptions, setTargetOptions] = useState<ReadonlyArray<{ id: string; label: string; detail?: string }>>([]);
  const [targetSearch, setTargetSearch] = useState("");
  const [targetCursor, setTargetCursor] = useState("");
  const [targetCursorStack, setTargetCursorStack] = useState<ReadonlyArray<string>>([]);
  const [targetNextCursor, setTargetNextCursor] = useState("");
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const load = useCallback(async (query: { search?: string; state?: string; kind?: string; sort?: "priority" | "created_desc"; cursor?: string } = {}) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (query.kind ?? kind) params.set("kind", query.kind ?? kind);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/content?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as OperatorDiscoveryContentRegistryResponse | { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل محتوى الاكتشاف." : "تعذر قراءة سجل محتوى الاكتشاف.");
      setRegistry(body as OperatorDiscoveryContentRegistryResponse);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, cursor, kind, sort, state]);

  async function readAnalytics(contentId: string) {
    setAnalyticsContentId(contentId);
    setAnalytics(null);
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`/api/marketing/analytics?contentId=${encodeURIComponent(contentId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { items?: ReadonlyArray<DiscoveryContentAnalytics>; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "تعذر قراءة تحليلات المحتوى المحدد.");
      setAnalytics(body?.items ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر قراءة تحليلات المحتوى المحدد.");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف.")); }, [load]);
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
    if (["STORE", "PRODUCT", "PROMOTION"].includes(contentForm.targetType) && targetSearch.trim().length < 2) {
      setTargetOptions([]);
      setTargetNextCursor("");
      setTargetMessage("اكتب حرفين على الأقل للبحث في الوجهات المتاحة.");
      setTargetLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ targetType: contentForm.targetType });
    if (contentForm.serviceCityId) params.set("serviceCityId", contentForm.serviceCityId);
    if (["STORE", "PRODUCT", "PROMOTION"].includes(contentForm.targetType)) params.set("query", targetSearch.trim());
    if (targetCursor) params.set("cursor", targetCursor);
    setTargetLoading(true);
    setTargetMessage("");
    void fetch(`/api/marketing/content/targets?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { options?: ReadonlyArray<{ id: string; label: string; detail?: string }>; nextCursor?: string; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر تحميل الوجهات.");
        setTargetOptions((current) => targetCursor ? [...current.filter((item) => !(body?.options ?? []).some((next) => next.id === item.id)), ...(body?.options ?? [])] : body?.options ?? []);
        setTargetNextCursor(body?.nextCursor ?? "");
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
  }, [contentForm.serviceCityId, contentForm.targetType, targetCursor, targetSearch]);

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
      setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
      setTargetSearch("");
      setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor("");
      setMediaFile(null);
      setMediaPreviewUrl("");
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", kind: "", sort: "priority", cursor: "" });
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
    <div className={styles.workspace} data-testid="marketing-content-workspace">
      <details className="access-card">
        <summary className={styles.createSummary}>إنشاء محتوى اكتشاف</summary>
        <div className="access-card-heading"><span className="step-chip">الاكتشاف</span><p className="eyebrow">محتوى منشور</p><h2>إنشاء بطاقة اكتشاف</h2><p className="muted">المحتوى العام لا يظهر إلا بعد نشره ومن خلال مسار DSH القانوني.</p></div>
        <div className="workspace-form-grid">
          <input aria-label="عنوان المحتوى" placeholder="مختارات الأسبوع" value={contentForm.titleAr} onChange={(event) => setContentForm((current) => ({ ...current, titleAr: event.target.value }))} />
          <input aria-label="نص المحتوى" placeholder="اكتشف الجديد في مدينتك" value={contentForm.bodyAr} onChange={(event) => setContentForm((current) => ({ ...current, bodyAr: event.target.value }))} />
          <label className="field-label" htmlFor="marketing-content-kind">نوع المحتوى<select id="marketing-content-kind" aria-label="نوع المحتوى" value={contentForm.kind} onChange={(event) => setContentForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="BANNER">بنر رئيسي</option><option value="CAROUSEL">شريحة كاروسيل</option><option value="SHORT_FORM">قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="marketing-content-media">صورة المحتوى<input id="marketing-content-media" aria-label="ملف صورة المحتوى" type="file" accept="image/jpeg,image/png" required onChange={(event) => { const file = event.target.files?.[0] ?? null; setMediaFile(file); setMediaPreviewUrl(file ? URL.createObjectURL(file) : ""); }} /></label>
          {mediaFile ? <p className="muted" data-testid="marketing-content-file">{mediaFile.name} · {(mediaFile.size / 1024).toFixed(0)} كيلوبايت</p> : <p className="muted">JPEG أو PNG، حتى 10 ميجابايت.</p>}
          {mediaPreviewUrl ? <div><p className="muted">معاينة تقريبية لاقتصاص الصورة في بطاقة الهاتف:</p><img className="workspace-discovery-preview" src={mediaPreviewUrl} alt="معاينة صورة محتوى الاكتشاف" /></div> : null}
          <label className="field-label" htmlFor="marketing-content-target">نوع الوجهة<select id="marketing-content-target" aria-label="نوع وجهة المحتوى" value={contentForm.targetType} onChange={(event) => { setTargetSearch(""); setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetType: event.target.value as typeof current.targetType, targetId: "" })); }}><option value="INFO">معلومات فقط</option><option value="STORE">متجر</option><option value="PRODUCT">منتج</option><option value="CATEGORY">فئة</option><option value="PROMOTION">عرض</option></select></label>
          {contentForm.targetType !== "INFO" ? <>
            <input aria-label="بحث في الوجهات" placeholder={`ابحث ${contentForm.targetType === "STORE" ? "عن متجر" : contentForm.targetType === "PRODUCT" ? "عن منتج" : contentForm.targetType === "PROMOTION" ? "عن عرض" : "لتصفية الوجهات"}`} value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); setTargetCursor(""); setTargetCursorStack([]); setTargetOptions([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetId: "" })); }} />
            <label className="field-label" htmlFor="marketing-content-target-option">الوجهة المعتمدة<select id="marketing-content-target-option" aria-label="الوجهة المعتمدة" value={contentForm.targetId} disabled={targetLoading || targetOptions.length === 0} onChange={(event) => setContentForm((current) => ({ ...current, targetId: event.target.value }))}>
              <option value="">{targetLoading ? "جارٍ تحميل الوجهات…" : "اختر وجهة من بيانات DSH"}</option>
              {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.detail ? `${option.label} · ${option.detail}` : option.label}</option>)}
            </select></label>
            {!["CATEGORY", "INFO"].includes(contentForm.targetType) ? <nav className={styles.pagination} aria-label="صفحات وجهات المحتوى"><button className="button button-quiet" type="button" disabled={targetLoading || targetCursorStack.length === 0} onClick={() => { const next = [...targetCursorStack]; setTargetCursor(next.pop() ?? ""); setTargetCursorStack(next); }}>السابق</button><span>{targetCursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={targetLoading || !targetNextCursor} onClick={() => { setTargetCursorStack((items) => [...items, targetCursor]); setTargetCursor(targetNextCursor); }}>تحميل المزيد</button></nav> : null}
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}
            <p className="muted">تُختار الوجهة من السجلات المعتمدة، ويعيد DSH التحقق من صلاحيتها حسب المدينة ووقت العرض.</p>
          </> : null}
          <label className="field-label" htmlFor="marketing-content-city">مدينة الخدمة<select id="marketing-content-city" aria-label="مدينة خدمة المحتوى" value={contentForm.serviceCityId} onChange={(event) => { setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, serviceCityId: event.target.value, targetId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <input aria-label="بداية المحتوى" type="datetime-local" value={contentStartsAt} onChange={(event) => setContentStartsAt(event.target.value)} />
          <input aria-label="نهاية المحتوى" type="datetime-local" value={contentEndsAt} onChange={(event) => setContentEndsAt(event.target.value)} />
          <input aria-label="ترتيب المحتوى" inputMode="numeric" type="number" min="0" value={contentForm.ordinal} onChange={(event) => setContentForm((current) => ({ ...current, ordinal: event.target.value }))} />
          <button className="button" type="button" disabled={busy} onClick={() => void createContent()}>إنشاء مسودة المحتوى</button>
        </div>
      </details>
      <section className="access-card" aria-labelledby="marketing-content-title">
        <div className="access-card-heading"><h2 id="marketing-content-title">سجل محتوى الاكتشاف</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="content-search">عنوان المحتوى<input id="content-search" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="content-state">الحالة<select id="content-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option></select></label>
          <label className="field-label" htmlFor="content-kind-filter">النوع<select id="content-kind-filter" value={kind} onChange={(event) => { setKind(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الأنواع</option><option value="BANNER">بنر</option><option value="CAROUSEL">كاروسيل</option><option value="SHORT_FORM">قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="content-sort">الترتيب<select id="content-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="priority">أولوية العرض</option><option value="created_desc">الأحدث إنشاءً</option></select></label>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
          <button className="button button-quiet" type="button" onClick={() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف."))} disabled={loading}>{loading ? "جارٍ القراءة…" : "تحديث"}</button>
        </form>
        {registry?.items.length ? <div className="finance-table-wrap"><table className="finance-table"><caption className="visually-hidden">سجل محتوى الاكتشاف</caption><thead><tr><th scope="col">المحتوى</th><th scope="col">النوع والوجهة</th><th scope="col">الحالة</th><th scope="col">الأولوية والبداية</th><th scope="col">الإجراءات</th></tr></thead><tbody>{registry.items.map((item) => <tr key={item.id}><th scope="row">{item.mediaUri ? <img className={styles.mediaPreview} src={item.mediaUri} alt="" loading="lazy" /> : null}{item.titleAr}<br /><bdi dir="ltr">{item.id}</bdi></th><td>{item.kind} · {item.targetType}<br />{item.targetId ? <bdi dir="ltr">{item.targetId}</bdi> : "معلومات عامة"}</td><td>{item.state === "DRAFT" ? "مسودة" : item.state === "PUBLISHED" ? "منشور" : "موقوف"}</td><td>{item.ordinal}<br /><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td><div className={styles.actions}><button className="button button-quiet" type="button" disabled={analyticsLoading} onClick={() => void readAnalytics(item.id)}>{analyticsLoading && analyticsContentId === item.id ? "جارٍ قراءة التحليلات…" : "قراءة التحليلات"}</button><button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف المحتوى" : "نشر المحتوى"}</button></div></td></tr>)}</tbody></table></div> : loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة المحتوى…</p> : <p className="collection-state">لا يوجد محتوى مطابق.</p>}
        <nav className={styles.pagination} aria-label="صفحات سجل محتوى الاكتشاف"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
        {analyticsContentId ? <aside className={styles.analyticsPanel} aria-live="polite"><strong>تحليلات المحتوى <bdi dir="ltr">{analyticsContentId}</bdi></strong>{analyticsLoading ? <p role="status">جارٍ قراءة النتائج…</p> : analytics ? <dl><div><dt>الظهور</dt><dd>{analytics.find((item) => item.eventType === "IMPRESSION")?.count ?? 0}</dd></div><div><dt>النقر</dt><dd>{analytics.find((item) => item.eventType === "CLICK")?.count ?? 0}</dd></div><div><dt>التحويل</dt><dd>{analytics.find((item) => item.eventType === "CONVERSION")?.count ?? 0}</dd></div></dl> : null}<button className="button button-quiet" type="button" onClick={() => { setAnalyticsContentId(""); setAnalytics(null); }}>إغلاق التحليلات</button></aside> : null}
      </section>
    </div>
  );
}
