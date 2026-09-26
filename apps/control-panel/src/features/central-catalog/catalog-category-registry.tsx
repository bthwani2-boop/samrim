"use client";

import type { CatalogCategory, CommerceVertical } from "@bthwani/dsh";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../session/session-provider";
import { CatalogAttributePolicyWorkspace } from "./catalog-attribute-policy-workspace";

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

function isDescendant(candidateId: string, ancestorId: string, byId: ReadonlyMap<string, CatalogCategory>): boolean {
  let parentId = byId.get(candidateId)?.parentCategoryId ?? "";
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentCategoryId ?? "";
  }
  return false;
}

function categoryDepth(category: CatalogCategory, byId: ReadonlyMap<string, CatalogCategory>): number {
  let depth = 0;
  let parentId = category.parentCategoryId ?? "";
  const visited = new Set([category.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentCategoryId ?? "";
  }
  return depth;
}

export function CatalogCategoryRegistry({ verticals, verticalId, onVerticalChange, categories, categoryId, onCategoryChange, loading, onSaved, management }: {
  verticals: ReadonlyArray<CommerceVertical>;
  verticalId: string;
  onVerticalChange: (verticalId: string) => void;
  categories: ReadonlyArray<CatalogCategory>;
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  loading: boolean;
  onSaved: () => Promise<void>;
  management?: ReactNode;
}) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);
  const [parentCategoryId, setParentCategoryId] = useState("");
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
  const [categoryStatus, setCategoryStatus] = useState<"all" | "active" | "inactive">("all");
  const [visibleCategoryIds, setVisibleCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const [filtering, setFiltering] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const filterSequence = useRef(0);
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

  const categoryIndex = new Map(categories.map((category) => [category.id, category]));
  const orderedCategories = [...categories].sort((left, right) => categoryDepth(left, categoryIndex) - categoryDepth(right, categoryIndex) || left.nameAr.localeCompare(right.nameAr, "ar"));
  const selectedVertical = verticals.find((vertical) => vertical.id === verticalId);
  const focusedCategory = categoryIndex.get(categoryId) ?? null;
  const childrenByParent = new Map<string, CatalogCategory[]>();
  for (const category of orderedCategories) {
    const parentId = category.parentCategoryId ?? "";
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), category]);
  }
  const rootCount = childrenByParent.get("")?.length ?? 0;
  const childCount = categories.length - rootCount;
  const activeCount = categories.filter((category) => category.active).length;
  const verticalReady = Boolean(selectedVertical?.active && selectedVertical.catalogModel === "SHARED_CATALOG");
  const mainActionLabel = verticalReady ? "فئة رئيسية جديدة" : selectedVertical ? selectedVertical.active ? "راجع مسار المجال" : "إعداد المجال المتوقف" : verticals.length ? "اختر المجال أولًا" : "إعداد المجال التجاري";

  useEffect(() => {
    setVisibleCategoryIds(new Set(categories.map((category) => category.id)));
    const parentIds = new Set(categories.map((category) => category.parentCategoryId).filter((parentId): parentId is string => Boolean(parentId)));
    setExpandedCategoryIds(new Set(categories.filter((category) => parentIds.has(category.id)).map((category) => category.id)));
  }, [categories]);

  function categoryPath(category: CatalogCategory): string {
    const names = [category.nameAr];
    let parentId = category.parentCategoryId ?? "";
    const visited = new Set([category.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = categoryIndex.get(parentId);
      if (!parent) break;
      names.push(parent.nameAr);
      parentId = parent.parentCategoryId ?? "";
    }
    return names.reverse().join(" / ");
  }

  function openCreate(nextParentCategoryId = "") {
    setEditingCategory(null);
    setParentCategoryId(nextParentCategoryId);
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function edit(category: CatalogCategory) {
    setEditingCategory(category);
    setEditorOpen(true);
    onVerticalChange(category.verticalId);
    onCategoryChange(category.id);
    setParentCategoryId(category.parentCategoryId ?? "");
    setNameAr(category.nameAr);
    setNameEn(category.nameEn);
    setActive(category.active);
    setReason("");
    setError("");
    setNotice("");
  }

  function closeEditor() {
    setEditingCategory(null);
    setEditorOpen(false);
    setParentCategoryId("");
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
    setError("");
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
      const payload = await parseResponse<{ category: CatalogCategory }>(response);
      setNotice(editingCategory ? `تم تحديث «${payload.category.nameAr}».` : `تمت إضافة «${payload.category.nameAr}».`);
      setEditingCategory(null);
      setEditorOpen(false);
      setNameAr("");
      setNameEn("");
      setParentCategoryId("");
      setReason("");
      setCategoryQuery("");
      setCategoryStatus("all");
      onCategoryChange(payload.category.id);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر حفظ الفئة.");
    } finally {
      setBusy(false);
    }
  }

  async function filterCategories(query = categoryQuery, status = categoryStatus) {
    if (!verticalId) {
      setVisibleCategoryIds(new Set());
      return;
    }
    const requestId = ++filterSequence.current;
    setFiltering(true);
    setError("");
    try {
      const params = new URLSearchParams({ verticalId, includeInactive: "true", status });
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(`/api/catalog/categories?${params}`, { cache: "no-store" });
      const payload = await parseResponse<{ categories: ReadonlyArray<CatalogCategory> }>(response);
      if (requestId !== filterSequence.current) return;
      const visible = new Set(payload.categories.map((category) => category.id));
      for (const category of payload.categories) {
        let parentId = category.parentCategoryId ?? "";
        while (parentId && categoryIndex.has(parentId) && !visible.has(parentId)) {
          visible.add(parentId);
          parentId = categoryIndex.get(parentId)?.parentCategoryId ?? "";
        }
      }
      setVisibleCategoryIds(visible);
      setExpandedCategoryIds(visible);
    } catch (nextError) {
      if (requestId === filterSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر البحث في الفئات.");
    } finally {
      if (requestId === filterSequence.current) setFiltering(false);
    }
  }

  async function uploadCategoryImage(category: CatalogCategory) {
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
      const payload = await parseResponse<{ category: CatalogCategory }>(response);
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

  function toggleBranch(branchId: string) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  function renderCategory(category: CatalogCategory): ReactNode {
    if (!visibleCategoryIds.has(category.id)) return null;
    const children = childrenByParent.get(category.id) ?? [];
    const visibleChildren = children.filter((child) => visibleCategoryIds.has(child.id));
    const expanded = expandedCategoryIds.has(category.id) || Boolean(categoryQuery.trim());
    const depth = categoryDepth(category, categoryIndex);
    return <li key={category.id} className="catalog-taxonomy-tree-node">
      <div className={"catalog-taxonomy-tree-row" + (category.id === categoryId ? " is-selected" : "")}>
        {visibleChildren.length ? <button type="button" className="catalog-taxonomy-tree-toggle" aria-expanded={expanded} aria-label={(expanded ? "طي" : "فتح") + " فروع " + category.nameAr} onClick={() => toggleBranch(category.id)}>{expanded ? "−" : "+"}</button> : <span className="catalog-taxonomy-tree-spacer" aria-hidden="true" />}
        <button type="button" className="catalog-taxonomy-tree-select" aria-pressed={category.id === categoryId} onClick={() => { onCategoryChange(category.id); setEditorOpen(false); setEditingCategory(null); setError(""); }}>
          {category.imageUri ? <img className="catalog-taxonomy-tree-image" src={category.imageUri} alt="" loading="lazy" /> : <span className="catalog-taxonomy-tree-image-fallback" aria-hidden="true">{category.nameAr.slice(0, 1)}</span>}
          <strong>{category.nameAr}</strong>
          <span className="catalog-taxonomy-tree-meta"><bdi dir="ltr">{category.nameEn}</bdi><span>{depth === 0 ? "رئيسية" : depth === 1 ? "فرعية" : `المستوى ${depth + 1}`}</span></span>
        </button>
        <span className="catalog-taxonomy-child-count">{children.length} فروع</span>
        <span className={"catalog-taxonomy-tree-status" + (category.active ? " is-active" : "")}>{category.active ? "نشطة" : "متوقفة"}</span>
        <div className="catalog-taxonomy-row-actions">
          <button type="button" className="catalog-row-action" disabled={!canEdit || busy || !category.active} onClick={() => openCreate(category.id)}>＋ فرعية</button>
          <button type="button" className="catalog-row-action" disabled={!canEdit || busy} onClick={() => edit(category)}>تعديل</button>
        </div>
      </div>
      {visibleChildren.length && expanded ? <ul className="catalog-taxonomy-tree-children">{visibleChildren.map(renderCategory)}</ul> : null}
    </li>;
  }

  return <section className="access-card catalog-taxonomy-workbench" aria-labelledby="catalog-category-registry-title">
    <div className="catalog-taxonomy-workbench-heading">
      <div>
        <span className="eyebrow">سجل تصنيف المنتجات</span>
        <h3 id="catalog-category-registry-title">الفئات</h3>
        <p className="muted">رتّب المنتجات في شجرة واضحة. أنشئ الفئة الرئيسية أولًا، ثم أضف الفروع عند الحاجة.</p>
      </div>
      <button type="button" className="button button-primary catalog-taxonomy-main-action" disabled={!canEdit || busy} onClick={() => { if (verticalReady) openCreate(); else if (selectedVertical || verticals.length === 0) { const settings = verticalSettingsRef.current?.querySelector("details"); if (settings) settings.open = true; settings?.scrollIntoView({ behavior: "smooth", block: "center" }); } else document.getElementById("catalog-taxonomy-vertical")?.focus(); }}>{mainActionLabel}</button>
    </div>

    <div className="catalog-taxonomy-controls">
      <label className="field-label" htmlFor="catalog-taxonomy-vertical">المجال التجاري<select id="catalog-taxonomy-vertical" value={verticalId} disabled={loading} onChange={(event) => onVerticalChange(event.target.value)}><option value="">اختر المجال التجاري</option>{verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · متوقف"}</option>)}</select></label>
      {selectedVertical ? <dl className="catalog-taxonomy-overview"><div><dt>رئيسية</dt><dd>{rootCount}</dd></div><i aria-hidden="true" /><div><dt>فرعية</dt><dd>{childCount}</dd></div><i aria-hidden="true" /><div><dt>نشطة</dt><dd>{activeCount}</dd></div></dl> : null}
    </div>

    {error && !editorOpen ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" disabled={loading || busy} onClick={() => void onSaved()}>إعادة المحاولة</button></p> : null}
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}

    {editorOpen ? <div className="catalog-category-editor">
          <div className="catalog-category-detail-heading">
            <span className="catalog-category-monogram" aria-hidden="true">{nameAr.trim().slice(0, 1) || "＋"}</span>
            <div><span className="eyebrow">{editingCategory ? "تحرير" : parentCategoryId ? "فئة فرعية جديدة" : "فئة رئيسية جديدة"}</span><h4>{editingCategory ? "تعديل الفئة" : "إضافة فئة"}</h4></div>
          </div>
          <label className="field-label" htmlFor="catalog-category-parent">تتبع الفئة<select id="catalog-category-parent" disabled={busy || !canEdit || !verticalId} value={parentCategoryId} onChange={(event) => setParentCategoryId(event.target.value)}><option value="">فئة رئيسية</option>{orderedCategories.filter((category) => !editingCategory || (category.id !== editingCategory.id && !isDescendant(category.id, editingCategory.id, categoryIndex))).map((category) => <option value={category.id} key={category.id}>{"　".repeat(Math.min(categoryDepth(category, categoryIndex), 6))}{category.nameAr}{category.active ? "" : " · متوقفة"}</option>)}</select></label>
          <label className="field-label" htmlFor="catalog-category-name-ar">الاسم بالعربية<input id="catalog-category-name-ar" disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={160} autoComplete="off" /></label>
          <label className="field-label" htmlFor="catalog-category-name-en">الاسم بالإنجليزية<input id="catalog-category-name-en" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={160} dir="auto" autoComplete="off" /></label>
          {editingCategory ? <label className="catalog-category-active-toggle"><input id="catalog-category-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> إظهار الفئة للمنتجات</label> : null}
          <label className="field-label" htmlFor="catalog-category-reason">سبب التغيير<textarea id="catalog-category-reason" className="resize-none" disabled={busy || !canEdit} minLength={5} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="catalog-category-reason-help" /></label>
          <small id="catalog-category-reason-help" className="muted">مطلوب للتوثيق · {reason.trim().length}/500</small>
          {error ? <p className="identity-error" role="alert">{error}</p> : null}
          <div className="catalog-category-editor-actions"><button type="button" className="button button-primary" disabled={busy || !canEdit || reason.trim().length < 5} onClick={() => void saveCategory()}>{busy ? "جارٍ الحفظ…" : editingCategory ? "حفظ التعديل" : "إضافة الفئة"}</button><button type="button" className="button button-secondary" disabled={busy} onClick={closeEditor}>إلغاء</button></div>
        </div> : null}

    {verticalId && selectedVertical?.active && selectedVertical.catalogModel === "SHARED_CATALOG" ? <>
      <form className="catalog-category-filters" noValidate onSubmit={(event) => { event.preventDefault(); void filterCategories(); }}>
        <div className="catalog-category-search-field"><label className="field-label" htmlFor="catalog-category-search">بحث<input id="catalog-category-search" type="search" maxLength={160} value={categoryQuery} disabled={loading || filtering} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="اسم الفئة بالعربية أو الإنجليزية" /></label>{categoryQuery ? <button type="button" className="button button-quiet catalog-category-clear" aria-label="مسح بحث الفئات" disabled={filtering} onClick={() => { filterSequence.current += 1; setCategoryQuery(""); setCategoryStatus("all"); void filterCategories("", "all"); }}>مسح</button> : null}</div>
        <label className="field-label" htmlFor="catalog-category-status">الحالة<select id="catalog-category-status" value={categoryStatus} disabled={loading || filtering} onChange={(event) => setCategoryStatus(event.target.value as typeof categoryStatus)}><option value="all">كل الحالات</option><option value="active">نشطة</option><option value="inactive">متوقفة</option></select></label>
        <button type="submit" className="button button-secondary" disabled={loading || filtering}>{filtering ? "جارٍ البحث…" : "بحث"}</button>
      </form>
      <div className="catalog-taxonomy-results-line"><span>{categories.length} فئة في {selectedVertical.nameAr}</span><span>الأب ← الفرع</span></div>
      <div className="catalog-taxonomy-records">
        <div className="catalog-taxonomy-record-heading" aria-hidden="true"><span>الفئة ومسارها</span><span>الفروع</span><span>الحالة</span><span>الإجراء</span></div>
        {loading ? <p className="catalog-taxonomy-feedback" role="status">جارٍ تحميل شجرة الفئات…</p> : categories.length === 0 ? <div className="catalog-taxonomy-empty catalog-taxonomy-empty-inset"><strong>لا توجد فئات في هذا المجال</strong><p>أنشئ الفئة الرئيسية الأولى من الزر أعلى السجل، ثم أضف الفروع من صفها.</p></div> : visibleCategoryIds.size === 0 ? <div className="catalog-taxonomy-feedback" role="status">لا توجد فئات مطابقة. غيّر البحث أو الحالة.</div> : rootCount === 0 ? <div className="catalog-taxonomy-feedback" role="alert">تعذر تكوين الشجرة من سجل الفئات الحالي. أعد قراءة السجل أو راجع علاقات الفئات.</div> : <ul className="catalog-taxonomy-tree">{(childrenByParent.get("") ?? []).filter((category) => visibleCategoryIds.has(category.id)).map(renderCategory)}</ul>}
      </div>
      {focusedCategory && !editorOpen ? <section className="catalog-category-detail" aria-labelledby="catalog-category-detail-title">
          <div className="catalog-category-detail-heading">
            {focusedCategory.imageUri ? <img className="catalog-category-detail-image" src={focusedCategory.imageUri} alt={`صورة ${focusedCategory.nameAr}`} /> : <span className="catalog-category-monogram" aria-hidden="true">{focusedCategory.nameAr.slice(0, 1)}</span>}
            <div><span className="eyebrow">{categoryDepth(focusedCategory, categoryIndex) === 0 ? "فئة رئيسية" : "فئة فرعية"}</span><h4 id="catalog-category-detail-title">{focusedCategory.nameAr}</h4><bdi dir="ltr">{focusedCategory.nameEn}</bdi></div>
          </div>
          <p className="catalog-category-breadcrumb">{categoryPath(focusedCategory)}</p>
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
