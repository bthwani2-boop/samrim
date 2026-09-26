"use client";

import type { BaseUnit, CatalogAttributeRule, CatalogAttributeValueInput, CatalogProduct, CatalogProductRegistryResponse, CatalogVariant, CommerceVertical, MeasurementKind } from "@bthwani/dsh";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

type ProductForm = { verticalId: string; scope: "SHARED" | "STORE_SCOPED"; canonicalName: string; description: string; brand: string; variantTitle: string; measurementKind: MeasurementKind; baseUnit: BaseUnit; categoryId: string; identifierType: string; identifierValue: string; imageUri: string; galleryImageUris: string; active: boolean };

const emptyForm: ProductForm = { verticalId: "", scope: "SHARED", canonicalName: "", description: "", brand: "", variantTitle: "", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryId: "", identifierType: "GTIN", identifierValue: "", imageUri: "", galleryImageUris: "", active: true };
type AttributeDrafts = Readonly<Record<string, string>>;
type AttributeInputSet = Readonly<{ productValues: ReadonlyArray<CatalogAttributeValueInput>; variantValues: ReadonlyArray<CatalogAttributeValueInput> }>;
type CatalogLocationState = Readonly<{ query: string; verticalId: string; categoryId: string; active: string; sort: string; mode?: "create" | "edit"; productId?: string }>;

function writeCatalogLocation(state: CatalogLocationState) {
  const url = new URL(window.location.href);
  for (const key of ["q", "verticalId", "categoryId", "active", "sort", "mode", "productId"]) url.searchParams.delete(key);
  if (state.query) url.searchParams.set("q", state.query);
  if (state.verticalId) url.searchParams.set("verticalId", state.verticalId);
  if (state.categoryId) url.searchParams.set("categoryId", state.categoryId);
  if (state.active !== "all") url.searchParams.set("active", state.active);
  if (state.sort !== "name_asc") url.searchParams.set("sort", state.sort);
  if (state.mode) url.searchParams.set("mode", state.mode);
  if (state.productId) url.searchParams.set("productId", state.productId);
  window.history.pushState({ catalogRegistry: true }, "", `${url.pathname}${url.search}${url.hash}`);
}

function buildAttributeInputs(rules: ReadonlyArray<CatalogAttributeRule>, drafts: AttributeDrafts): AttributeInputSet | null {
  const productValues: CatalogAttributeValueInput[] = [];
  const variantValues: CatalogAttributeValueInput[] = [];
  for (const rule of rules) {
    const raw = drafts[rule.attributeId]?.trim() ?? "";
    if (!raw) { if (rule.required) return null; continue; }
    let value: CatalogAttributeValueInput;
    switch (rule.valueKind) {
      case "TEXT": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, textValue: raw }; break;
      case "INTEGER": { const parsed = Number(raw); if (!Number.isSafeInteger(parsed)) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, integerValue: parsed }; break; }
      case "DECIMAL": { if (!Number.isFinite(Number(raw))) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw }; break; }
      case "MEASUREMENT": { const unit = drafts[rule.attributeId + ":unit"]?.trim() ?? ""; if (!Number.isFinite(Number(raw)) || !unit) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw, measurementUnit: unit }; break; }
      case "BOOLEAN": if (raw !== "true" && raw !== "false") return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, booleanValue: raw === "true" }; break;
      case "ENUM": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, enumValue: raw }; break;
      case "DATE": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, dateValue: raw }; break;
    }
    (rule.variantAxis ? variantValues : productValues).push(value);
  }
  return { productValues, variantValues };
}

function readError(value: unknown): string {
  if (!value || typeof value !== "object") return "تعذر تنفيذ العملية.";
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return "تعذر تنفيذ العملية.";
  const message = (nested as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "تعذر تنفيذ العملية.";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(readError(payload)), { status: response.status });
  return payload as T;
}

function firstVariant(product: CatalogProduct): CatalogVariant | undefined { return product.variants[0]; }

function toForm(product: CatalogProduct): ProductForm {
  const variant = firstVariant(product);
  const identifier = variant?.identifiers[0];
  const orderedMedia = [...product.media].sort((left, right) => left.ordinal - right.ordinal);
  return { verticalId: product.verticalId ?? "", scope: product.scope as ProductForm["scope"], canonicalName: product.canonicalName, description: product.description ?? "", brand: product.brand ?? "", variantTitle: variant?.title ?? "", measurementKind: variant?.measurementKind ?? "DISCRETE", baseUnit: variant?.baseUnit ?? "COUNT", categoryId: product.categoryIds[0] ?? "", identifierType: identifier?.type ?? "GTIN", identifierValue: identifier?.value ?? "", imageUri: orderedMedia.find((item) => item.role === "primary")?.uri ?? "", galleryImageUris: orderedMedia.filter((item) => item.role === "gallery").map((item) => item.uri).join("\n"), active: product.active };
}

function mediaInput(form: ProductForm) {
  const primary = form.imageUri.trim();
  const gallery = form.galleryImageUris.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return [
    ...(primary ? [{ uri: primary, role: "primary" as const, ordinal: 0 }] : []),
    ...gallery.map((uri, index) => ({ uri, role: "gallery" as const, ordinal: index + 1 })),
  ];
}

export function CentralCatalog() {
  const [products, setProducts] = useState<CatalogProductRegistryResponse["products"]>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>>([]);
  const [filterCategories, setFilterCategories] = useState<ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>>([]);
  const [attributeRules, setAttributeRules] = useState<ReadonlyArray<CatalogAttributeRule>>([]);
  const [enumOptions, setEnumOptions] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const [attributeDrafts, setAttributeDrafts] = useState<AttributeDrafts>({});
  const [attributeReadState, setAttributeReadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [detailLoading, setDetailLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadRole, setUploadRole] = useState<"primary" | "gallery">("primary");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const sharedVerticals = verticals.filter((vertical) => vertical.catalogModel === "SHARED_CATALOG");

  const loadVerticals = useCallback(async () => {
    const response = await fetch("/api/catalog/verticals", { cache: "no-store" });
    const payload = await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response);
    setVerticals(payload.verticals);
    return payload.verticals;
  }, []);

  const loadCategories = useCallback(async (verticalId: string) => {
    if (!verticalId) { setCategories([]); return; }
    const response = await fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(verticalId)}`, { cache: "no-store" });
    const payload = await parseResponse<{ categories: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }> }>(response);
    setCategories(payload.categories);
  }, []);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestSequence = ++listRequestSequence.current;
    setLoading(true);
    setError("");
    try {
      const suffix = new URLSearchParams({ limit: "50", active: statusFilter, sort });
      if (appliedQuery.trim()) suffix.set("q", appliedQuery.trim());
      if (verticalFilter) suffix.set("verticalId", verticalFilter);
      if (categoryFilter) suffix.set("categoryId", categoryFilter);
      if (cursor) suffix.set("cursor", cursor);
      const response = await fetch(`/api/catalog/product-registry?${suffix.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const payload = await parseResponse<CatalogProductRegistryResponse>(response);
      if (requestSequence !== listRequestSequence.current) return;
      setProducts((current) => append ? [...current, ...payload.products] : payload.products);
      if (!append) setSelectedIds(new Set());
      setNextCursor(payload.nextCursor ?? "");
    } catch (nextError) {
      if (requestSequence === listRequestSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الكتالوج.");
    } finally {
      if (requestSequence === listRequestSequence.current) setLoading(false);
    }
  }, [appliedQuery, verticalFilter, categoryFilter, statusFilter, sort]);

  useEffect(() => { void loadVerticals().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات الرئيسية.")); }, [loadVerticals]);
  useEffect(() => { void loadCategories(form.verticalId).catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات.")); }, [form.verticalId, loadCategories]);
  useEffect(() => {
    let current = true;
    setAttributeRules([]); setEnumOptions({}); setAttributeDrafts({});
    if (selected || !form.categoryId) { setAttributeReadState("idle"); return () => { current = false; }; }
    setAttributeReadState("loading");
    void (async () => {
      const rulesResponse = await fetch(`/api/catalog/categories/${encodeURIComponent(form.categoryId)}/attribute-rules`, { cache: "no-store" });
      const rules = (await parseResponse<{ rules: ReadonlyArray<CatalogAttributeRule> }>(rulesResponse)).rules;
      const optionPairs = await Promise.all(rules.filter((rule) => rule.valueKind === "ENUM").map(async (rule) => {
        const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(rule.attributeId)}/enum-options`, { cache: "no-store" });
        const options = (await parseResponse<{ options: ReadonlyArray<{ optionValue: string }> }>(response)).options;
        return [rule.attributeId, options.map((option) => option.optionValue)] as const;
      }));
      if (current) { setAttributeRules(rules); setEnumOptions(Object.fromEntries(optionPairs)); setAttributeReadState("ready"); }
    })().catch((nextError) => { if (current) { setAttributeReadState("error"); setError(nextError instanceof Error ? nextError.message : "تعذر قراءة قواعد الخصائص."); } });
    return () => { current = false; };
  }, [form.categoryId, selected]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let current = true;
    if (!verticalFilter) { setFilterCategories([]); setCategoryFilter(""); return () => { current = false; }; }
    void fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(verticalFilter)}`, { cache: "no-store" })
      .then(parseResponse<{ categories: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }> }>)
      .then((payload) => { if (current) setFilterCategories(payload.categories); })
      .catch((nextError) => { if (current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات."); });
    return () => { current = false; };
  }, [verticalFilter]);

  async function selectProduct(productId: string, updateLocation = true) {
    const requestSequence = ++detailRequestSequence.current;
    if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "edit", productId });
    setDetailLoading(true); setSelected(null); setEditorOpen(true); setNotice(""); setError("");
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
      const detail = await parseResponse<CatalogProduct>(response);
      if (requestSequence !== detailRequestSequence.current) return;
      setSelected(detail); setForm(toForm(detail)); setUploadFile(null); setUploadRole("primary");
    } catch (nextError) { if (requestSequence === detailRequestSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة تفاصيل المنتج."); }
    finally { if (requestSequence === detailRequestSequence.current) setDetailLoading(false); }
  }
  function startCreate(updateLocation = true) { detailRequestSequence.current += 1; if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "create" }); setDetailLoading(false); setSelected(null); setEditorOpen(true); setForm(emptyForm); setUploadFile(null); setUploadRole("primary"); setNotice(""); setError(""); }

  const restoreCatalogLocation = useEffectEvent(() => {
    const params = new URL(window.location.href).searchParams;
    const nextQuery = params.get("q") ?? "";
    const nextVertical = params.get("verticalId") ?? "";
    const nextCategory = params.get("categoryId") ?? "";
    const nextActive = params.get("active") ?? "all";
    const nextSort = params.get("sort") ?? "name_asc";
    setQuery(nextQuery); setAppliedQuery(nextQuery); setVerticalFilter(nextVertical); setCategoryFilter(nextCategory); setStatusFilter(nextActive); setSort(nextSort);
    const mode = params.get("mode");
    const productId = params.get("productId");
    if (mode === "edit" && productId) void selectProduct(productId, false);
    else if (mode === "create") startCreate(false);
    else { detailRequestSequence.current += 1; setEditorOpen(false); setSelected(null); setDetailLoading(false); }
  });

  useEffect(() => {
    const restore = () => restoreCatalogLocation();
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function renderAttributeFields() {
    if (selected || !form.categoryId || attributeReadState !== "ready" || attributeRules.length === 0) return null;
    return <section className="managed-status managed-status-info" aria-label="خصائص الفئة">
      <strong>خصائص الفئة</strong>
      {attributeRules.map((rule) => <label className="field-label" htmlFor={`product-attribute-${rule.attributeId}`} key={rule.attributeId}>
        {rule.nameAr}{rule.required ? " · مطلوب" : " · اختياري"}{rule.variantAxis ? " · خاص بالنسخة" : ""}
        {rule.valueKind === "BOOLEAN" ? <select id={`product-attribute-${rule.attributeId}`} value={attributeDrafts[rule.attributeId] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [rule.attributeId]: event.target.value }))}><option value="">اختر قيمة</option><option value="true">نعم</option><option value="false">لا</option></select>
          : rule.valueKind === "ENUM" ? <select id={`product-attribute-${rule.attributeId}`} value={attributeDrafts[rule.attributeId] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [rule.attributeId]: event.target.value }))}><option value="">اختر قيمة</option>{(enumOptions[rule.attributeId] ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
            : <input id={`product-attribute-${rule.attributeId}`} inputMode={rule.valueKind === "INTEGER" || rule.valueKind === "DECIMAL" || rule.valueKind === "MEASUREMENT" ? "decimal" : "text"} value={attributeDrafts[rule.attributeId] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [rule.attributeId]: event.target.value }))} />}
        {rule.valueKind === "MEASUREMENT" ? <input aria-label={`وحدة ${rule.nameAr}`} placeholder="وحدة القياس" value={attributeDrafts[rule.attributeId + ":unit"] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [rule.attributeId + ":unit"]: event.target.value }))} /> : null}
      </label>)}
    </section>;
  }

  async function saveProduct() {
    if (busy || form.scope !== "SHARED" || !form.canonicalName.trim() || !form.verticalId || !form.categoryId) return;
    if (!selected && attributeReadState !== "ready") { setError("تعذر التحقق من خصائص الفئة. أعد قراءة القواعد قبل إنشاء المنتج."); return; }
    const attributes = selected ? null : buildAttributeInputs(attributeRules, attributeDrafts);
    if (!selected && !attributes) { setError("أكمل الخصائص المطلوبة وتحقق من أنواع القيم قبل إنشاء المنتج."); return; }
    setBusy(true); setError(""); setNotice("");
    const body = { canonicalName: form.canonicalName.trim(), description: form.description.trim(), verticalId: form.verticalId, scope: "SHARED" as const, measurementKind: form.measurementKind, baseUnit: form.baseUnit, categoryIds: [form.categoryId], attributeValues: attributes?.productValues ?? [], variantAttributeValues: attributes?.variantValues ?? [], ...(form.variantTitle.trim() ? { variantTitle: form.variantTitle.trim() } : {}), ...(form.brand.trim() ? { brand: form.brand.trim() } : {}), ...(form.identifierValue.trim() ? { identifierType: form.identifierType, identifierValue: form.identifierValue.trim() } : {}), ...(form.imageUri.trim() ? { imageUri: form.imageUri.trim() } : {}), active: form.active };
    try {
      const response = selected
        ? await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body: JSON.stringify({ canonicalName: body.canonicalName, description: body.description, verticalId: body.verticalId, scope: body.scope, active: body.active, ...(body.brand ? { brand: body.brand } : {}) }) })
        : await fetch("/api/catalog/products", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      setSelected(payload.product); setForm(toForm(payload.product));
      writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "edit", productId: payload.product.id });
      setNotice(selected ? "تم تحديث المنتج." : "تم إنشاء المنتج والنسخة الافتراضية."); await load();
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setError("تغير المنتج قبل حفظك. أُعيدت قراءة السجل الحالي؛ راجع النسخة ثم أعد المحاولة.");
        await load();
        if (selected) await selectProduct(selected.id, false);
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر حفظ المنتج.");
      }
    } finally { setBusy(false); }
  }

  async function saveMedia() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body: JSON.stringify({ media: mediaInput(form) }) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      setSelected(payload.product); setForm(toForm(payload.product)); setNotice("تم حفظ صور المنتج.");
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setError("تغير المنتج قبل حفظ الصور. أُعيدت قراءة السجل الحالي؛ راجع الصور ثم أعد المحاولة.");
        await load();
        await selectProduct(selected.id, false);
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر حفظ صور المنتج.");
      }
    } finally { setBusy(false); }
  }

  async function uploadMedia() {
    if (!selected || !uploadFile || busy) return;
    setBusy(true); setError(""); setNotice("");
    const body = new FormData();
    body.set("role", uploadRole);
    body.set("file", uploadFile, uploadFile.name);
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}/media`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      setSelected(payload.product); setForm(toForm(payload.product)); setUploadFile(null); setUploadInputKey((value) => value + 1); setNotice(uploadRole === "primary" ? "تم رفع الصورة الأساسية وربطها بالمنتج." : "تم رفع الصورة وإضافتها إلى المعرض.");
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setError("تغير المنتج قبل رفع الصورة. أُعيدت قراءة السجل الحالي؛ راجع النسخة ثم أعد المحاولة.");
        await load();
        await selectProduct(selected.id, false);
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر رفع صورة المنتج.");
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="central-catalog-grid">
      <section className="access-card central-catalog-list" aria-labelledby="central-catalog-list-title">
        <div className="catalog-registry-heading"><div><p className="eyebrow">سجل تشغيلي مركزي</p><h2 id="central-catalog-list-title">المنتجات</h2><p className="muted">تُحمّل قائمة موجزة من الخادم؛ وتُقرأ التفاصيل والعلاقات عند فتح السجل.</p></div><button type="button" className="button button-primary" disabled={busy || verticals.length === 0} onClick={() => startCreate()}>منتج جديد</button></div>
        <form className="catalog-registry-toolbar" onSubmit={(event) => { event.preventDefault(); const nextQuery = query.trim(); writeCatalogLocation({ query: nextQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setAppliedQuery(nextQuery); }}>
          <label className="catalog-search-input">بحث<input aria-label="البحث في المنتجات" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم المنتج أو العلامة" /></label>
          <label>الفئة الرئيسية<select value={verticalFilter} onChange={(event) => { const verticalId = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId, categoryId: "", active: statusFilter, sort }); setVerticalFilter(verticalId); setCategoryFilter(""); }}><option value="">الكل</option>{sharedVerticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
          <label>الفئة<select disabled={!verticalFilter} value={categoryFilter} onChange={(event) => { const categoryId = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId, active: statusFilter, sort }); setCategoryFilter(categoryId); }}><option value="">كل الفئات</option>{filterCategories.map((category) => <option value={category.id} key={category.id}>{category.nameAr}</option>)}</select></label>
          <label>الحالة<select value={statusFilter} onChange={(event) => { const active = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active, sort }); setStatusFilter(active); }}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">معطل</option></select></label>
          <label>الترتيب<select value={sort} onChange={(event) => { const sort = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setSort(sort); }}><option value="name_asc">الاسم أ–ي</option><option value="name_desc">الاسم ي–أ</option><option value="updated_desc">الأحدث تعديلًا</option><option value="updated_asc">الأقدم تعديلًا</option></select></label>
          <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          {query || appliedQuery ? <button type="button" className="button button-quiet" onClick={() => { writeCatalogLocation({ query: "", verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setQuery(""); setAppliedQuery(""); }}>مسح البحث</button> : null}
        </form>
        <div className="catalog-selection-bar" aria-live="polite"><span>{selectedIds.size ? `تم تحديد ${selectedIds.size} من هذه الصفحة` : `${products.length}${nextCursor ? "+" : ""} سجل في النتيجة الحالية`}</span>{selectedIds.size ? <button type="button" className="button button-quiet" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button> : null}</div>
        <div className="catalog-registry-table-wrap">
          <table className="catalog-registry-table">
            <thead><tr><th><input aria-label="تحديد جميع سجلات الصفحة" type="checkbox" checked={products.length > 0 && selectedIds.size === products.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(products.map((item) => item.id)) : new Set())} /></th><th>المنتج</th><th>الفئة الرئيسية</th><th>الفئات</th><th>النسخ</th><th>الحالة</th><th>آخر تحديث</th><th>الإجراء</th></tr></thead>
            <tbody>
              {loading && products.length === 0 ? <tr><td colSpan={8} className="catalog-table-state">جارٍ قراءة السجل…</td></tr> : null}
              {!loading && products.length === 0 ? <tr><td colSpan={8} className="catalog-table-state">لا توجد منتجات مطابقة للفلاتر.</td></tr> : null}
              {products.map((product) => <tr key={product.id} className={selected?.id === product.id ? "is-open" : ""}>
                <td><input type="checkbox" aria-label={`تحديد ${product.canonicalName}`} checked={selectedIds.has(product.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} /></td>
                <td><strong>{product.canonicalName}</strong><small>{product.brand || product.id}</small></td>
                <td>{sharedVerticals.find((vertical) => vertical.id === product.verticalId)?.nameAr ?? product.verticalId}</td>
                <td>{product.categoryIds.length}</td><td>{product.variantCount}</td>
                <td><span className={`catalog-state-pill ${product.active ? "is-active" : "is-inactive"}`}>{product.active ? "نشط" : "معطل"}</span></td>
                <td><time dateTime={product.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(product.updatedAt))}</time></td>
                <td><button type="button" className="catalog-row-action" disabled={detailLoading} onClick={() => void selectProduct(product.id)}>تفاصيل وتعديل</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {error ? <p className="identity-error" role="alert">{error}</p> : null}
        {nextCursor ? <button type="button" className="button button-secondary catalog-load-more" disabled={loading} onClick={() => void load(nextCursor, true)}>{loading ? "جارٍ التحميل…" : "تحميل المزيد"}</button> : null}
      </section>
      {editorOpen ? <section className="access-card central-catalog-editor" aria-labelledby="central-catalog-editor-title">
        {detailLoading ? <p className="muted" role="status">جارٍ قراءة التفاصيل والعلاقات من الخادم…</p> : null}
        <div className="access-card-heading"><p className="eyebrow">تحرير المنتج والنسخة</p><h2 id="central-catalog-editor-title">{selected ? "تعديل المنتج" : "إنشاء منتج"}</h2><p className="muted">تُحفظ الهوية والفئة والنسخة الافتراضية في سجل المنتجات.</p></div>
        <div className="central-product-form">
          <label className="field-label" htmlFor="catalog-vertical">الفئة الرئيسية<select id="catalog-vertical" disabled={busy || selected !== null} value={form.verticalId} onChange={(event) => { setForm({ ...form, verticalId: event.target.value, categoryId: "" }); setAttributeDrafts({}); }}><option value="">اختر فئة رئيسية</option>{sharedVerticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
          <label className="field-label" htmlFor="catalog-category">الفئة<select id="catalog-category" disabled={busy || selected !== null || !form.verticalId} value={form.categoryId} onChange={(event) => { setForm({ ...form, categoryId: event.target.value }); setAttributeDrafts({}); }}><option value="">اختر فئة</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.nameAr}</option>)}</select></label>
          {!selected && form.categoryId ? attributeReadState === "loading" ? <p className="muted">جارٍ قراءة قواعد خصائص الفئة…</p> : attributeReadState === "error" ? <p className="identity-error" role="alert">تعذرت قراءة قواعد الخصائص. أعد المحاولة قبل إنشاء المنتج.</p> : renderAttributeFields() : null}
          {form.scope === "STORE_SCOPED" ? <p className="muted">هذا المنتج خاص بمتجر ويُدار من مساحة المتجر.</p> : null}
          <label className="field-label" htmlFor="catalog-product-name">الاسم القياسي<input id="catalog-product-name" disabled={busy} value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-product-description">الوصف القياسي<textarea id="catalog-product-description" disabled={busy} maxLength={4000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-product-brand">العلامة<input id="catalog-product-brand" disabled={busy} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-variant-title">عنوان النسخة<input id="catalog-variant-title" disabled={busy || selected !== null} value={form.variantTitle} onChange={(event) => setForm({ ...form, variantTitle: event.target.value })} placeholder="الافتراضي" /></label>
          <label className="field-label" htmlFor="catalog-measurement-kind">سياسة القياس<select id="catalog-measurement-kind" disabled={busy || selected !== null} value={form.measurementKind} onChange={(event) => { const measurementKind = event.target.value as MeasurementKind; setForm({ ...form, measurementKind, baseUnit: measurementKind === "DISCRETE" ? "COUNT" : form.baseUnit === "COUNT" ? "GRAM" : form.baseUnit }); }}><option value="DISCRETE">عددي</option><option value="MEASURED">مقاس ثابت</option><option value="VARIABLE_MEASURE">مقاس متغير</option></select></label>
          <label className="field-label" htmlFor="catalog-base-unit">الوحدة الأساسية<select id="catalog-base-unit" disabled={busy || selected !== null} value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value as BaseUnit })}><option value="COUNT">قطعة</option><option value="GRAM">غرام</option><option value="MILLILITER">مل</option></select></label>
          <label className="field-label" htmlFor="catalog-identifier">نوع المعرّف<input id="catalog-identifier" disabled={busy || selected !== null} value={form.identifierType} onChange={(event) => setForm({ ...form, identifierType: event.target.value.toUpperCase() })} /></label>
          <label className="field-label" htmlFor="catalog-identifier-value">قيمة المعرّف<input id="catalog-identifier-value" disabled={busy || selected !== null} value={form.identifierValue} onChange={(event) => setForm({ ...form, identifierValue: event.target.value })} /></label>
          {selected ? <><label className="field-label" htmlFor="catalog-image">رابط الصورة الأساسية<input id="catalog-image" disabled={busy} inputMode="url" value={form.imageUri} onChange={(event) => setForm({ ...form, imageUri: event.target.value })} placeholder="https://…" /></label><label className="field-label" htmlFor="catalog-gallery">صور المعرض<textarea className="resize-none" id="catalog-gallery" disabled={busy} rows={4} value={form.galleryImageUris} onChange={(event) => setForm({ ...form, galleryImageUris: event.target.value })} placeholder="رابط صورة في كل سطر" /></label><p className="muted">الصورة الأساسية إلزامية عند وجود صور، وكل رابط معرض يظهر بعده حسب الترتيب.</p><div className="catalog-media-upload"><label className="field-label" htmlFor="catalog-upload-role">نوع الرفع<select id="catalog-upload-role" disabled={busy} value={uploadRole} onChange={(event) => setUploadRole(event.target.value as "primary" | "gallery")}><option value="primary">صورة أساسية</option><option value="gallery">صورة معرض</option></select></label><label className="field-label" htmlFor="catalog-upload-file">ملف الصورة<input key={uploadInputKey} id="catalog-upload-file" disabled={busy} type="file" accept="image/jpeg,image/png" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="button button-secondary" disabled={busy || !uploadFile} onClick={() => void uploadMedia()}>رفع الصورة وربطها</button></div>{form.imageUri ? <img className="catalog-media-preview" src={form.imageUri} alt={`الصورة الأساسية لمنتج ${form.canonicalName}`} loading="lazy" /> : null}</> : <label className="field-label" htmlFor="catalog-image">رابط الصورة الأساسية<input id="catalog-image" disabled={busy} inputMode="url" value={form.imageUri} onChange={(event) => setForm({ ...form, imageUri: event.target.value })} placeholder="https://…" /></label>}
          {selected ? <label className="central-active-toggle"><input type="checkbox" disabled={busy} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> المنتج نشط وقابل للاختيار</label> : null}
          <button type="button" className="button button-primary" disabled={busy || form.scope !== "SHARED" || (!selected && attributeReadState !== "ready") || !form.canonicalName.trim() || !form.verticalId || !form.categoryId} onClick={() => void saveProduct()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إنشاء المنتج"}</button>
          {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void saveMedia()}>حفظ الصور</button> : null}
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => { writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); detailRequestSequence.current += 1; setDetailLoading(false); setEditorOpen(false); setSelected(null); }}>إغلاق التفاصيل</button>
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
      </section> : null}
    </div>
  );
}
