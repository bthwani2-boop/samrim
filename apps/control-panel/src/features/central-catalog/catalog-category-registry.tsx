"use client";

import type { CatalogCategoryListItem, CatalogCategoryListResponse, CatalogCategoryResponse, CommerceVertical } from "@bthwani/dsh";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { CatalogAttributePolicyWorkspace } from "./catalog-attribute-policy-workspace";

type CategoryStatus = "all" | "active" | "inactive";
type CategorySort = "name_asc" | "name_desc" | "updated_desc";

function readError(value: unknown): string {
  if (!value || typeof value !== "object") return "تعذر تنفيذ العملية.";
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return "تعذر تنفيذ العملية.";
  const message = (nested as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(payload));
  return payload as T;
}

export function CatalogCategoryRegistry({ verticals, verticalId, onVerticalChange, categories, nextCursor, onFilter, categoryId, onCategoryChange, loading, onSaved, management }: {
  verticals: ReadonlyArray<CommerceVertical>;
  verticalId: string;
  onVerticalChange: (verticalId: string) => void;
  categories: CatalogCategoryListResponse["categories"];
  nextCursor: string;
  onFilter: (query: string, status: CategoryStatus, sort: CategorySort, cursor: string, append: boolean) => Promise<void>;
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  loading: boolean;
  onSaved: () => Promise<void>;
  management?: ReactNode;
}) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [editingCategory, setEditingCategory] = useState<CatalogCategoryListItem | null>(null);
  const [categoryDetail, setCategoryDetail] = useState<CatalogCategoryListItem | null>(null);
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [parentOptions, setParentOptions] = useState<ReadonlyArray<CatalogCategoryListItem>>([]);
  const [parentNextCursor, setParentNextCursor] = useState("");
  const [parentLoading, setParentLoading] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [categoryImageFile, setCategoryImageFile] = useState<File | null>(null);
  const [categoryImagePreview, setCategoryImagePreview] = useState("");
  const [mediaReason, setMediaReason] = useState("إضافة صورة توضيحية للفئة");
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryStatus, setCategoryStatus] = useState<CategoryStatus>("all");
  const [categorySort, setCategorySort] = useState<CategorySort>("name_asc");
  const [filtering, setFiltering] = useState(false);
  const parentSearchSequence = useRef(0);
  const categoryDetailSequence = useRef(0);
  const verticalSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!categoryImageFile) {
      setCategoryImagePreview("");
      return;
    }
    const preview = URL.createObjectURL(categoryImageFile);
    setCategoryImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [categoryImageFile]);

  const categoryIndex = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const selectedVertical = verticals.find((vertical) => vertical.id === verticalId);
  const focusedCategory = categoryIndex.get(categoryId) ?? categoryDetail;
  const verticalReady = Boolean(selectedVertical?.active && selectedVertical.catalogModel === "SHARED_CATALOG");
  const mainActionLabel = verticalReady ? "فئة رئيسية جديدة" : selectedVertical ? selectedVertical.active ? "راجع مسار المجال" : "إعداد المجال المتوقف" : verticals.length ? "اختر المجال أولًا" : "إعداد المجال التجاري";

  useEffect(() => {
    const requestId = ++categoryDetailSequence.current;
    const current = categories.find((category) => category.id === categoryId);
    if (!categoryId || current) {
      setCategoryDetail(current ?? null);
      return;
    }
    let activeRequest = true;
    void fetch(`/api/catalog/categories/${encodeURIComponent(categoryId)}`, { cache: "no-store" })
      .then((response) => parseResponse<{ category: CatalogCategoryListItem }>(response))
      .then((payload) => {
        if (payload.category.verticalId !== verticalId) throw new Error("الفئة المحددة لا تتبع المجال المختار.");
        if (activeRequest && requestId === categoryDetailSequence.current) setCategoryDetail(payload.category);
      })
      .catch((nextError) => { if (activeRequest && requestId === categoryDetailSequence.current) { setCategoryDetail(null); setError(nextError instanceof Error ? nextError.message : "تعذر قراءة تفاصيل الفئة."); } });
    return () => { activeRequest = false; };
  }, [categories, categoryId, verticalId]);

  function openCreate(nextParentCategoryId = "") {
    parentSearchSequence.current += 1;
    setEditingCategory(null);
    setParentCategoryId(nextParentCategoryId);
    const parent = categoryIndex.get(nextParentCategoryId);
    setParentOptions(parent ? [parent] : categories);
    setParentNextCursor("");
    setParentSearch(parent?.pathAr ?? "");
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function edit(category: CatalogCategoryListItem) {
    const parentRequestId = ++parentSearchSequence.current;
    setEditingCategory(category);
    setEditorOpen(true);
    onCategoryChange(category.id);
    setParentCategoryId(category.parentCategoryId ?? "");
    setParentOptions([]);
    setParentNextCursor("");
    setParentSearch("");
    if (category.parentCategoryId) {
      void fetch(`/api/catalog/categories/${encodeURIComponent(category.parentCategoryId)}`, { cache: "no-store" })
        .then((response) => parseResponse<{ category: CatalogCategoryListItem }>(response))
        .then((payload) => { if (parentRequestId === parentSearchSequence.current) { setParentOptions([payload.category]); setParentSearch(payload.category.pathAr); } })
        .catch((nextError) => { if (parentRequestId === parentSearchSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئة الأعلى."); });
    }
    setNameAr(category.nameAr);
    setNameEn(category.nameEn);
    setActive(category.active);
    setReason("");
    setError("");
    setNotice("");
  }

  function closeEditor() {
    parentSearchSequence.current += 1;
    setEditingCategory(null);
    setEditorOpen(false);
    setParentCategoryId("");
    setParentSearch("");
    setParentOptions([]);
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
    setError("");
  }

  async function searchParents(cursor = "", append = false) {
    if (!verticalId) return;
    const query = parentSearch.trim();
    if (query.length > 160 || (query.length > 0 && query.length < 2)) {
      setError("اكتب حرفين على الأقل للبحث عن الفئة الأعلى.");
      return;
    }
    const requestId = ++parentSearchSequence.current;
    setParentLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ verticalId, status: "all", sort: "name_asc", limit: "25" });
      if (query) params.set("query", query);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/categories?${params.toString()}`, { cache: "no-store" });
      const page = await parseResponse<CatalogCategoryListResponse>(response);
      if (requestId !== parentSearchSequence.current) return;
      setParentOptions((current) => append ? [...current, ...page.categories] : page.categories);
      setParentNextCursor(page.nextCursor ?? "");
    } catch (nextError) {
      if (requestId === parentSearchSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر البحث عن الفئة الأعلى.");
    } finally {
      if (requestId === parentSearchSequence.current) setParentLoading(false);
    }
  }

  async function saveCategory() {
    if (!canEdit) return;
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    const normalizedReason = reason.trim();
    if (!verticalId || !selectedVertical?.active || selectedVertical.catalogModel !== "SHARED_CATALOG") {
      setError("اختر مجالًا نشطًا يستخدم كتالوج المنتجات المشتركة.");
      return;
    }
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) {
      setError("اكتب اسمًا عربيًا وإنجليزيًا من حرفين إلى 160 حرفًا لكل منهما.");
      return;
    }
    if (normalizedReason.length < 5 || normalizedReason.length > 500) {
      setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق التغيير.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(editingCategory ? `/api/catalog/categories/${encodeURIComponent(editingCategory.id)}` : "/api/catalog/categories", {
        method: editingCategory ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          ...(editingCategory ? { parentCategoryId, expectedVersion: editingCategory.version } : { verticalId, parentCategoryId: parentCategoryId || null }),
          nameAr: normalizedNameAr,
          nameEn: normalizedNameEn,
          active,
          reason: normalizedReason,
        }),
      });
      const payload = await parseResponse<CatalogCategoryResponse>(response);
      setNotice(editingCategory ? `تم تحديث «${payload.category.nameAr}».` : `تمت إضافة «${payload.category.nameAr}».`);
      setEditingCategory(null);
      setEditorOpen(false);
      setNameAr("");
      setNameEn("");
      setParentCategoryId("");
      setParentSearch("");
      setReason("");
      setCategoryQuery("");
      setCategoryStatus("all");
      setCategorySort("name_asc");
      onCategoryChange(payload.category.id);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر حفظ الفئة.");
    } finally {
      setBusy(false);
    }
  }

  async function filterCategories(query = categoryQuery, status = categoryStatus, sort = categorySort) {
    setFiltering(true);
    setError("");
    try {
      await onFilter(query.trim(), status, sort, "", false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر البحث في الفئات.");
    } finally {
      setFiltering(false);
    }
  }

  async function loadMoreCategories() {
    if (!nextCursor || loading || filtering) return;
    setFiltering(true);
    setError("");
    try {
      await onFilter(categoryQuery.trim(), categoryStatus, categorySort, nextCursor, true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر تحميل الصفحة التالية.");
    } finally {
      setFiltering(false);
    }
  }

  async function uploadCategoryImage(category: CatalogCategoryListItem) {
    if (!canEdit || !categoryImageFile || mediaReason.trim().length < 5) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", categoryImageFile, categoryImageFile.name || "category-image");
      form.set("reason", mediaReason.trim());
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(category.id)}/media`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(category.version) },
        body: form,
      });
      const payload = await parseResponse<CatalogCategoryResponse>(response);
      setNotice(`تم إرفاق صورة «${payload.category.nameAr}».`);
      setCategoryImageFile(null);
      onCategoryChange(payload.category.id);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر رفع صورة الفئة.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="access-card catalog-taxonomy-workbench" aria-labelledby="catalog-category-registry-title">
    <div className="catalog-taxonomy-workbench-heading">
      <div>
        <span className="eyebrow">سجل تصنيف المنتجات</span>
        <h3 id="catalog-category-registry-title">الفئات</h3>
        <p className="muted">ابحث ورتّب سجل الفئات من الخادم، وافتح تفاصيل الفئة عند الحاجة.</p>
      </div>
      <button type="button" className="button button-primary catalog-taxonomy-main-action" disabled={!canEdit || busy} onClick={() => { if (verticalReady) openCreate(); else if (selectedVertical || verticals.length === 0) { const settings = verticalSettingsRef.current; settings?.querySelector("summary")?.click(); settings?.scrollIntoView({ behavior: "smooth", block: "center" }); } else onVerticalChange(verticals.find((vertical) => vertical.active)?.id ?? ""); }}>{mainActionLabel}</button>
    </div>
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}

    {editorOpen ? <div className="catalog-category-editor">
      <div className="catalog-category-detail-heading">
        <span className="catalog-category-monogram" aria-hidden="true">{nameAr.trim().slice(0, 1) || "＋"}</span>
        <div><span className="eyebrow">{editingCategory ? "تحرير" : parentCategoryId ? "فئة فرعية جديدة" : "فئة رئيسية جديدة"}</span><h4>{editingCategory ? "تعديل الفئة" : "إضافة فئة"}</h4></div>
      </div>
      <form className="catalog-category-filters" noValidate onSubmit={(event) => { event.preventDefault(); void searchParents(); }}>
        <label className="field-label" htmlFor="catalog-category-parent-search">بحث عن الفئة الأعلى<input id="catalog-category-parent-search" type="search" maxLength={160} value={parentSearch} disabled={busy || !canEdit || !verticalId} onChange={(event) => setParentSearch(event.target.value)} placeholder="اتركه فارغًا لعرض الفئات المحملة أو ابحث بالاسم" /></label>
        <button type="submit" className="button button-secondary" disabled={busy || parentLoading || !verticalId}>{parentLoading ? "جارٍ البحث…" : "بحث"}</button>
      </form>
      <label className="field-label" htmlFor="catalog-category-parent">تتبع الفئة<select id="catalog-category-parent" disabled={busy || !canEdit || !verticalId} value={parentCategoryId} onChange={(event) => setParentCategoryId(event.target.value)}><option value="">فئة رئيسية</option>{parentOptions.filter((category) => category.id !== editingCategory?.id).map((category) => <option value={category.id} key={category.id}>{category.pathAr}{category.active ? "" : " · متوقفة"}</option>)}</select></label>
      {parentNextCursor ? <button type="button" className="button button-quiet" disabled={parentLoading} onClick={() => void searchParents(parentNextCursor, true)}>تحميل المزيد من الفئات الأعلى</button> : null}
      <p className="muted">يتحقق DSH عند الحفظ من المجال ومنع وضع الفئة تحت نفسها أو أحد فروعها.</p>
      <label className="field-label" htmlFor="catalog-category-name-ar">الاسم بالعربية<input id="catalog-category-name-ar" disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={160} autoComplete="off" /></label>
      <label className="field-label" htmlFor="catalog-category-name-en">الاسم بالإنجليزية<input id="catalog-category-name-en" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={160} dir="auto" autoComplete="off" /></label>
      {editingCategory ? <label className="catalog-category-active-toggle"><input id="catalog-category-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> إظهار الفئة للمنتجات</label> : null}
      <label className="field-label" htmlFor="catalog-category-reason">سبب التغيير<textarea id="catalog-category-reason" className="resize-none" disabled={busy || !canEdit} minLength={5} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="catalog-category-reason-help" /></label>
      <small id="catalog-category-reason-help" className="muted">مطلوب للتوثيق · {reason.trim().length}/500</small>
      <div className="catalog-category-editor-actions"><button type="button" className="button button-primary" disabled={busy || !canEdit || reason.trim().length < 5} onClick={() => void saveCategory()}>{busy ? "جارٍ الحفظ…" : editingCategory ? "حفظ التعديل" : "إضافة الفئة"}</button><button type="button" className="button button-secondary" disabled={busy} onClick={closeEditor}>إلغاء</button></div>
    </div> : null}

    {verticalId && selectedVertical?.active && selectedVertical.catalogModel === "SHARED_CATALOG" ? <>
      <form className="catalog-category-filters" noValidate onSubmit={(event) => { event.preventDefault(); void filterCategories(); }}>
        <div className="catalog-category-search-field"><label className="field-label" htmlFor="catalog-category-search">بحث<input id="catalog-category-search" type="search" maxLength={160} value={categoryQuery} disabled={loading || filtering} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="اسم الفئة بالعربية أو الإنجليزية" /></label>{categoryQuery ? <button type="button" className="button button-quiet catalog-category-clear" aria-label="مسح بحث الفئات" disabled={filtering} onClick={() => { setCategoryQuery(""); setCategoryStatus("all"); setCategorySort("name_asc"); void filterCategories("", "all", "name_asc"); }}>مسح</button> : null}</div>
        <label className="field-label" htmlFor="catalog-category-status">الحالة<select id="catalog-category-status" value={categoryStatus} disabled={loading || filtering} onChange={(event) => setCategoryStatus(event.target.value as CategoryStatus)}><option value="all">كل الحالات</option><option value="active">نشطة</option><option value="inactive">متوقفة</option></select></label>
        <label className="field-label" htmlFor="catalog-category-sort">الترتيب<select id="catalog-category-sort" value={categorySort} disabled={loading || filtering} onChange={(event) => setCategorySort(event.target.value as CategorySort)}><option value="name_asc">الاسم أ–ي</option><option value="name_desc">الاسم ي–أ</option><option value="updated_desc">الأحدث تعديلًا</option></select></label>
        <button type="submit" className="button button-secondary" disabled={loading || filtering}>{filtering ? "جارٍ البحث…" : "بحث"}</button>
      </form>
      <div className="catalog-taxonomy-results-line"><span>{categories.length}{nextCursor ? "+" : ""} سجل في {selectedVertical.nameAr}</span><span>{nextCursor ? "تتوفر صفحات أخرى" : "نهاية النتائج"}</span></div>
      <div className="catalog-taxonomy-records">
        <div className="catalog-taxonomy-record-heading" aria-hidden="true"><span>الفئة ومسارها</span><span>الموقع</span><span>الحالة</span><span>الإجراء</span></div>
        {loading && categories.length === 0 ? <p className="catalog-taxonomy-feedback" role="status">جارٍ تحميل صفحة الفئات…</p> : categories.length === 0 ? <div className="catalog-taxonomy-empty catalog-taxonomy-empty-inset"><strong>{categoryQuery ? "لا توجد فئات مطابقة" : "لا توجد فئات في هذا المجال"}</strong><p>{categoryQuery ? "غيّر نص البحث أو الحالة." : "أنشئ الفئة الرئيسية الأولى من الزر أعلى السجل، ثم أضف الفروع عند الحاجة."}</p></div> : <ul className="catalog-taxonomy-tree">{categories.map((category) => <li key={category.id} className="catalog-taxonomy-tree-node">
          <div className={"catalog-taxonomy-tree-row" + (category.id === categoryId ? " is-selected" : "")}>
            <span className="catalog-taxonomy-tree-spacer" aria-hidden="true" />
            <button type="button" className="catalog-taxonomy-tree-select" aria-pressed={category.id === categoryId} onClick={() => { onCategoryChange(category.id); setEditorOpen(false); setEditingCategory(null); setError(""); }}>
              {category.imageUri ? <img className="catalog-taxonomy-tree-image" src={category.imageUri} alt="" loading="lazy" /> : <span className="catalog-taxonomy-tree-image-fallback" aria-hidden="true">{category.nameAr.slice(0, 1)}</span>}
              <strong>{category.nameAr}</strong>
              <span className="catalog-taxonomy-tree-meta"><bdi dir="ltr">{category.nameEn}</bdi><span>{category.pathAr}</span></span>
            </button>
            <span className="catalog-taxonomy-child-count">{category.parentCategoryId ? "فئة فرعية" : "فئة رئيسية"}</span>
            <span className={"catalog-taxonomy-tree-status" + (category.active ? " is-active" : "")}>{category.active ? "نشطة" : "متوقفة"}</span>
            <div className="catalog-taxonomy-row-actions">
              <button type="button" className="catalog-row-action" disabled={!canEdit || busy || !category.active} onClick={() => openCreate(category.id)}>＋ فرعية</button>
              <button type="button" className="catalog-row-action" disabled={!canEdit || busy} onClick={() => edit(category)}>تعديل</button>
            </div>
          </div>
        </li>)}</ul>}
      </div>
      {nextCursor ? <div className="catalog-category-editor-actions"><button type="button" className="button button-secondary" disabled={loading || filtering} onClick={() => void loadMoreCategories()}>{filtering ? "جارٍ التحميل…" : "تحميل الصفحة التالية"}</button></div> : null}
      {focusedCategory && !editorOpen ? <section className="catalog-category-detail" aria-labelledby="catalog-category-detail-title">
        <div className="catalog-category-detail-heading">
          {focusedCategory.imageUri ? <img className="catalog-category-detail-image" src={focusedCategory.imageUri} alt={`صورة ${focusedCategory.nameAr}`} /> : <span className="catalog-category-monogram" aria-hidden="true">{focusedCategory.nameAr.slice(0, 1)}</span>}
          <div><span className="eyebrow">{focusedCategory.parentCategoryId ? "فئة فرعية" : "فئة رئيسية"}</span><h4 id="catalog-category-detail-title">{focusedCategory.nameAr}</h4><bdi dir="ltr">{focusedCategory.nameEn}</bdi></div>
        </div>
        <p className="catalog-category-breadcrumb">{focusedCategory.pathAr}</p>
        <span className={"catalog-state-pill " + (focusedCategory.active ? "is-active" : "is-inactive")}>{focusedCategory.active ? "نشطة" : "متوقفة"}</span>
        <div className="catalog-category-media-editor">
          <div className="catalog-category-media-preview">{categoryImagePreview || focusedCategory.imageUri ? <img src={categoryImagePreview || focusedCategory.imageUri || ""} alt={`معاينة صورة ${focusedCategory.nameAr}`} /> : <span aria-hidden="true">صورة الفئة</span>}</div>
          <div className="catalog-category-media-controls">
            <label className="field-label" htmlFor="catalog-category-image">صورة الفئة<input id="catalog-category-image" type="file" accept="image/jpeg,image/png" disabled={!canEdit || busy} onChange={(event) => setCategoryImageFile(event.target.files?.[0] ?? null)} /></label>
            <label className="field-label" htmlFor="catalog-category-image-reason">سبب الإرفاق<input id="catalog-category-image-reason" value={mediaReason} maxLength={500} disabled={!canEdit || busy} onChange={(event) => setMediaReason(event.target.value)} /></label>
            <button type="button" className="button button-secondary" disabled={!canEdit || busy || !categoryImageFile || mediaReason.trim().length < 5} onClick={() => void uploadCategoryImage(focusedCategory)}>{busy ? "جارٍ الرفع…" : focusedCategory.imageUri ? "استبدال الصورة" : "إرفاق الصورة"}</button>
          </div>
        </div>
        <div className="catalog-category-detail-actions">
          <button type="button" className="button button-primary" disabled={!canEdit || busy || !focusedCategory.active} onClick={() => openCreate(focusedCategory.id)}>إضافة فئة فرعية</button>
          <button type="button" className="button button-secondary" disabled={!canEdit || busy} onClick={() => edit(focusedCategory)}>تعديل الفئة</button>
        </div>
        <details className="catalog-category-properties">
          <summary>خصائص المنتجات وقواعد هذه الفئة</summary>
          <CatalogAttributePolicyWorkspace key={focusedCategory.id} verticalId={verticalId} categoryId={focusedCategory.id} />
        </details>
      </section> : null}
    </> : verticalId ? <div className="catalog-taxonomy-empty"><strong>المجال المحدد لا يستخدم المنتجات المشتركة</strong><p>اختر مجالًا بمسار «منتجات مشتركة» أو عدّل المسار من إعدادات المجالات التجارية أدناه.</p></div> : <div className="catalog-taxonomy-empty"><strong>لا توجد مجالات مشتركة نشطة</strong><p>فعّل مجالًا بمسار «منتجات مشتركة» من إدارة المجالات التجارية أدناه.</p></div>}
    <div ref={verticalSettingsRef}>{management}</div>
  </section>;
}
