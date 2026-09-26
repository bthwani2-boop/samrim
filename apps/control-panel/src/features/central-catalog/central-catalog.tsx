"use client";

import type { BaseUnit, CatalogAttributeRule, CatalogAttributeValue, CatalogAttributeValueInput, CatalogCategoryListItem, CatalogCategoryListResponse, CatalogProduct, CatalogProductRegistryResponse, CatalogVariant, CommerceVertical, MeasurementKind } from "@bthwani/dsh";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";

type ProductForm = { verticalId: string; scope: "SHARED" | "STORE_SCOPED"; canonicalName: string; description: string; brand: string; variantTitle: string; measurementKind: MeasurementKind; baseUnit: BaseUnit; categoryIds: ReadonlyArray<string>; identifierType: string; identifierValue: string; active: boolean };

const emptyForm: ProductForm = { verticalId: "", scope: "SHARED", canonicalName: "", description: "", brand: "", variantTitle: "", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [], identifierType: "GTIN", identifierValue: "", active: true };
type AttributeDrafts = Readonly<Record<string, string>>;
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

function buildAttributeValues(rules: ReadonlyArray<CatalogAttributeRule>, drafts: AttributeDrafts, variantId?: string): ReadonlyArray<CatalogAttributeValueInput> | null {
  const values: CatalogAttributeValueInput[] = [];
  for (const rule of rules) {
    if (Boolean(variantId) !== rule.variantAxis) continue;
    const key = variantId ? `${variantId}::${rule.attributeId}` : rule.attributeId;
    const raw = drafts[key]?.trim() ?? "";
    if (!raw) { if (rule.required) return null; continue; }
    let value: CatalogAttributeValueInput;
    switch (rule.valueKind) {
      case "TEXT": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, textValue: raw }; break;
      case "INTEGER": { const parsed = Number(raw); if (!Number.isSafeInteger(parsed)) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, integerValue: parsed }; break; }
      case "DECIMAL": { if (!Number.isFinite(Number(raw))) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw }; break; }
      case "MEASUREMENT": { const unit = drafts[key + ":unit"]?.trim() ?? ""; if (!Number.isFinite(Number(raw)) || !unit) return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, decimalValue: raw, measurementUnit: unit }; break; }
      case "BOOLEAN": if (raw !== "true" && raw !== "false") return null; value = { attributeId: rule.attributeId, valueKind: rule.valueKind, booleanValue: raw === "true" }; break;
      case "ENUM": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, enumValue: raw }; break;
      case "DATE": value = { attributeId: rule.attributeId, valueKind: rule.valueKind, dateValue: raw }; break;
    }
    values.push(value);
  }
  return values;
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

function categoryPath(categoryId: string, categories: ReadonlyArray<CatalogCategoryListItem>): string {
  return categories.find((category) => category.id === categoryId)?.pathAr ?? categoryId;
}

function attributeDraftsFromValues(product: CatalogProduct | null): AttributeDrafts {
  if (!product) return {};
  const drafts: Record<string, string> = {};
  for (const value of product.attributes) {
    const raw = value.textValue ?? value.integerValue?.toString() ?? value.decimalValue ?? (value.booleanValue === undefined || value.booleanValue === null ? undefined : String(value.booleanValue)) ?? value.enumValue ?? value.dateValue;
    if (raw !== undefined && raw !== null) drafts[value.attributeId] = raw;
    if (value.measurementUnit) drafts[value.attributeId + ":unit"] = value.measurementUnit;
  }
  for (const variant of product.variants) for (const value of variant.attributes) {
    const key = `${variant.id}::${value.attributeId}`;
    const raw = value.textValue ?? value.integerValue?.toString() ?? value.decimalValue ?? (value.booleanValue === undefined || value.booleanValue === null ? undefined : String(value.booleanValue)) ?? value.enumValue ?? value.dateValue;
    if (raw !== undefined && raw !== null) drafts[key] = raw;
    if (value.measurementUnit) drafts[key + ":unit"] = value.measurementUnit;
  }
  return drafts;
}

function toForm(product: CatalogProduct): ProductForm {
  const variant = firstVariant(product);
  const identifier = variant?.identifiers[0];
  return { verticalId: product.verticalId ?? "", scope: product.scope as ProductForm["scope"], canonicalName: product.canonicalName, description: product.description ?? "", brand: product.brand ?? "", variantTitle: variant?.title ?? "", measurementKind: variant?.measurementKind ?? "DISCRETE", baseUnit: variant?.baseUnit ?? "COUNT", categoryIds: product.categoryIds, identifierType: identifier?.type ?? "GTIN", identifierValue: identifier?.value ?? "", active: product.active };
}

export function CentralCatalog() {
  const [products, setProducts] = useState<CatalogProductRegistryResponse["products"]>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<CatalogCategoryListResponse["categories"]>([]);
  const [categoryNextCursor, setCategoryNextCursor] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [selectedCategoryDetails, setSelectedCategoryDetails] = useState<ReadonlyArray<CatalogCategoryListItem>>([]);
  const [filterCategories, setFilterCategories] = useState<CatalogCategoryListResponse["categories"]>([]);
  const [filterCategoryQuery, setFilterCategoryQuery] = useState("");
  const [filterCategoryNextCursor, setFilterCategoryNextCursor] = useState("");
  const [filterCategoryLoading, setFilterCategoryLoading] = useState(false);
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
  const categoryRequestSequence = useRef(0);
  const filterCategoryRequestSequence = useRef(0);
  const sharedVerticals = verticals.filter((vertical) => vertical.catalogModel === "SHARED_CATALOG");
  const selectedCategoryIdsKey = form.categoryIds.join("\u001f");

  const loadVerticals = useCallback(async () => {
    const response = await fetch("/api/catalog/verticals", { cache: "no-store" });
    const payload = await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response);
    setVerticals(payload.verticals);
    return payload.verticals;
  }, []);

  const loadCategories = useCallback(async (verticalId: string, query = "", cursor = "", append = false) => {
    const requestSequence = ++categoryRequestSequence.current;
    if (!verticalId) { setCategories([]); setCategoryNextCursor(""); setCategoryLoading(false); return; }
    setCategoryLoading(true);
    try {
      const params = new URLSearchParams({ verticalId, status: "all", sort: "name_asc", limit: "50" });
      if (query.trim()) params.set("query", query.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/categories?${params.toString()}`, { cache: "no-store" });
      const payload = await parseResponse<CatalogCategoryListResponse>(response);
      if (requestSequence !== categoryRequestSequence.current) return;
      setCategories((current) => append ? [...current, ...payload.categories] : payload.categories);
      setCategoryNextCursor(payload.nextCursor ?? "");
    } catch (nextError) {
      if (requestSequence === categoryRequestSequence.current) throw nextError;
    } finally {
      if (requestSequence === categoryRequestSequence.current) setCategoryLoading(false);
    }
  }, []);

  const loadFilterCategories = useCallback(async (query: string, cursor = "", append = false) => {
    const requestSequence = ++filterCategoryRequestSequence.current;
    if (!verticalFilter) { setFilterCategories([]); setFilterCategoryNextCursor(""); setFilterCategoryLoading(false); return; }
    setFilterCategoryLoading(true);
    try {
      const params = new URLSearchParams({ verticalId: verticalFilter, status: "all", sort: "name_asc", limit: "25" });
      if (query.trim()) params.set("query", query.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/categories?${params.toString()}`, { cache: "no-store" });
      const payload = await parseResponse<CatalogCategoryListResponse>(response);
      if (requestSequence !== filterCategoryRequestSequence.current) return;
      setFilterCategories((current) => append ? [...current, ...payload.categories] : payload.categories);
      setFilterCategoryNextCursor(payload.nextCursor ?? "");
    } catch (nextError) {
      if (requestSequence === filterCategoryRequestSequence.current) throw nextError;
    } finally {
      if (requestSequence === filterCategoryRequestSequence.current) setFilterCategoryLoading(false);
    }
  }, [verticalFilter]);

  const categoryChoices = useMemo(() => {
    const byId = new Map<string, CatalogCategoryListItem>();
    for (const category of [...categories, ...selectedCategoryDetails]) byId.set(category.id, category);
    return [...byId.values()].filter((category) => category.verticalId === form.verticalId);
  }, [categories, selectedCategoryDetails, form.verticalId]);

  async function searchProductCategories() {
    try { await loadCategories(form.verticalId, categorySearch); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "تعذر البحث في الفئات."); }
  }

  async function loadMoreProductCategories() {
    if (!categoryNextCursor || categoryLoading) return;
    try { await loadCategories(form.verticalId, categorySearch, categoryNextCursor, true); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "تعذر تحميل فئات إضافية."); }
  }

  async function searchFilterCategories() {
    try { await loadFilterCategories(filterCategoryQuery); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "تعذر البحث في الفئات."); }
  }

  async function loadMoreFilterCategories() {
    if (!filterCategoryNextCursor || filterCategoryLoading) return;
    try { await loadFilterCategories(filterCategoryQuery, filterCategoryNextCursor, true); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "تعذر تحميل فئات إضافية."); }
  }
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
  useEffect(() => { void loadCategories(form.verticalId, "").catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات.")); }, [form.verticalId, loadCategories]);
  useEffect(() => {
    let current = true;
    setAttributeRules([]); setEnumOptions({});
    const categoryIds = selectedCategoryIdsKey ? selectedCategoryIdsKey.split("\u001f") : [];
    if (categoryIds.length === 0) { setAttributeReadState("idle"); return () => { current = false; }; }
    setAttributeReadState("loading");
    void (async () => {
      const ruleSets = await Promise.all(categoryIds.map(async (categoryId) => {
        const response = await fetch(`/api/catalog/categories/${encodeURIComponent(categoryId)}/attribute-rules`, { cache: "no-store" });
        return (await parseResponse<{ rules: ReadonlyArray<CatalogAttributeRule> }>(response)).rules;
      }));
      const byAttribute = new Map<string, CatalogAttributeRule>();
      for (const rule of ruleSets.flat()) {
        const previous = byAttribute.get(rule.attributeId);
        if (!previous) byAttribute.set(rule.attributeId, rule);
        else {
          if (previous.valueKind !== rule.valueKind || previous.variantAxis !== rule.variantAxis || previous.code !== rule.code) throw new Error("تتعارض قواعد خاصية مشتركة بين الفئات المحددة.");
          byAttribute.set(rule.attributeId, { ...previous, required: previous.required || rule.required, filterable: previous.filterable || rule.filterable });
        }
      }
      const rules = [...byAttribute.values()];
      const optionPairs = await Promise.all(rules.filter((rule) => rule.valueKind === "ENUM").map(async (rule) => {
        const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(rule.attributeId)}/enum-options`, { cache: "no-store" });
        const options = (await parseResponse<{ options: ReadonlyArray<{ optionValue: string }> }>(response)).options;
        return [rule.attributeId, options.map((option) => option.optionValue)] as const;
      }));
      if (current) { setAttributeRules(rules); setEnumOptions(Object.fromEntries(optionPairs)); setAttributeReadState("ready"); }
    })().catch((nextError) => { if (current) { setAttributeReadState("error"); setError(nextError instanceof Error ? nextError.message : "تعذر قراءة قواعد الخصائص."); } });
    return () => { current = false; };
  }, [selectedCategoryIdsKey]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!verticalFilter) { filterCategoryRequestSequence.current += 1; setFilterCategories([]); setFilterCategoryNextCursor(""); setCategoryFilter(""); setFilterCategoryLoading(false); return; }
    setFilterCategoryQuery("");
    void loadFilterCategories("").catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات."));
  }, [verticalFilter, loadFilterCategories]);
  useEffect(() => {
    const selectedIDs = new Set(selectedCategoryIdsKey ? selectedCategoryIdsKey.split("\u001f") : []);
    setSelectedCategoryDetails((current) => {
      const next = current.filter((category) => selectedIDs.has(category.id));
      return next.length === current.length ? current : next;
    });
  }, [selectedCategoryIdsKey]);
  useEffect(() => {
    const missing = form.categoryIds.filter((id) => !categoryChoices.some((category) => category.id === id));
    if (!missing.length) return;
    let current = true;
    void Promise.all(missing.map(async (id) => {
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(id)}`, { cache: "no-store" });
      return (await parseResponse<{ category: CatalogCategoryListItem }>(response)).category;
    })).then((items) => { if (current) setSelectedCategoryDetails((existing) => [...new Map([...existing, ...items].map((category) => [category.id, category])).values()]); })
      .catch((nextError) => { if (current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات المحددة."); });
    return () => { current = false; };
  }, [form.categoryIds, categoryChoices]);
  useEffect(() => {
    if (!verticalFilter || !categoryFilter || filterCategories.some((category) => category.id === categoryFilter)) return;
    let current = true;
    void fetch(`/api/catalog/categories/${encodeURIComponent(categoryFilter)}`, { cache: "no-store" })
      .then((response) => parseResponse<{ category: CatalogCategoryListItem }>(response))
      .then((payload) => { if (current && payload.category.verticalId === verticalFilter) setFilterCategories((items) => [...items.filter((item) => item.id !== payload.category.id), payload.category]); })
      .catch((nextError) => { if (current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئة المحددة."); });
    return () => { current = false; };
  }, [verticalFilter, categoryFilter, filterCategories]);

  async function selectProduct(productId: string, updateLocation = true) {
    const requestSequence = ++detailRequestSequence.current;
    if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "edit", productId });
    setDetailLoading(true); setSelected(null); setEditorOpen(true); setNotice(""); setError("");
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
      const detail = await parseResponse<CatalogProduct>(response);
      if (requestSequence !== detailRequestSequence.current) return;
      setSelected(detail); setForm(toForm(detail)); setAttributeDrafts(attributeDraftsFromValues(detail)); setUploadFile(null); setUploadRole("primary");
    } catch (nextError) { if (requestSequence === detailRequestSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة تفاصيل المنتج."); }
    finally { if (requestSequence === detailRequestSequence.current) setDetailLoading(false); }
  }
  function startCreate(updateLocation = true) { detailRequestSequence.current += 1; if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "create" }); setDetailLoading(false); setSelected(null); setEditorOpen(true); setForm(emptyForm); setAttributeDrafts({}); setUploadFile(null); setUploadRole("primary"); setNotice(""); setError(""); }

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
    if (!form.categoryIds.length || attributeReadState !== "ready" || attributeRules.length === 0) return null;
    function renderField(rule: CatalogAttributeRule, variantId?: string) {
      const key = variantId ? `${variantId}::${rule.attributeId}` : rule.attributeId;
      const fieldId = `product-attribute-${variantId ?? "product"}-${rule.attributeId}`;
      return <label className="field-label" htmlFor={fieldId} key={fieldId}>
        {rule.nameAr}{rule.required ? " · مطلوب" : " · اختياري"}{rule.variantAxis ? " · خاص بالنسخة" : ""}
        {rule.valueKind === "BOOLEAN" ? <select id={fieldId} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر قيمة</option><option value="true">نعم</option><option value="false">لا</option></select>
          : rule.valueKind === "ENUM" ? <select id={fieldId} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر قيمة</option>{(enumOptions[rule.attributeId] ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>
            : <input id={fieldId} inputMode={rule.valueKind === "INTEGER" || rule.valueKind === "DECIMAL" || rule.valueKind === "MEASUREMENT" ? "decimal" : "text"} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))} />}
        {rule.valueKind === "MEASUREMENT" ? <input aria-label={`وحدة ${rule.nameAr}`} placeholder="وحدة القياس" value={attributeDrafts[key + ":unit"] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key + ":unit"]: event.target.value }))} /> : null}
      </label>;
    }
    const productRules = attributeRules.filter((rule) => !rule.variantAxis);
    const variantRules = attributeRules.filter((rule) => rule.variantAxis);
    return <section className="managed-status managed-status-info" aria-label="خصائص الفئة">
      <strong>خصائص المنتجات حسب الفئات المختارة</strong>
      {productRules.map((rule) => renderField(rule))}
      {variantRules.length ? (selected?.variants.length ? selected.variants.map((variant) => <fieldset className="catalog-variant-attributes" key={variant.id}><legend>{variant.title}</legend>{variantRules.map((rule) => renderField(rule, variant.id))}</fieldset>) : <fieldset className="catalog-variant-attributes"><legend>النسخة الافتراضية</legend>{variantRules.map((rule) => renderField(rule, "new"))}</fieldset>) : null}
    </section>;
  }

  function toggleProductCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    const alreadySelected = form.categoryIds.includes(categoryId);
    if (!category || busy || (!category.active && !alreadySelected)) return;
    setForm((current) => {
      const selectedIds = new Set(current.categoryIds);
      if (selectedIds.has(categoryId)) selectedIds.delete(categoryId);
      else selectedIds.add(categoryId);
      return { ...current, categoryIds: [...selectedIds] };
    });
    setError("");
  }

  async function saveProduct() {
    if (busy || form.scope !== "SHARED" || !form.canonicalName.trim() || !form.verticalId || form.categoryIds.length === 0) return;
    if (attributeReadState !== "ready") { setError("تعذر التحقق من خصائص الفئات. أعد قراءة القواعد قبل الحفظ."); return; }
    const productAttributes = buildAttributeValues(attributeRules, attributeDrafts);
    const createVariantAttributes = selected ? null : buildAttributeValues(attributeRules, attributeDrafts, "new");
    const updateVariantAttributes = selected ? selected.variants.map((variant) => ({ variantId: variant.id, values: buildAttributeValues(attributeRules, attributeDrafts, variant.id) })) : null;
    if (!productAttributes || (!selected && !createVariantAttributes) || (selected && (!updateVariantAttributes?.length || updateVariantAttributes.some((set) => set.values === null)))) { setError("أكمل الخصائص المطلوبة لكل نسخة وتحقق من أنواع القيم قبل الحفظ."); return; }
    setBusy(true); setError(""); setNotice("");
    const body = { canonicalName: form.canonicalName.trim(), description: form.description.trim(), verticalId: form.verticalId, scope: "SHARED" as const, measurementKind: form.measurementKind, baseUnit: form.baseUnit, categoryIds: [...form.categoryIds], attributeValues: productAttributes, variantAttributeValues: createVariantAttributes ?? [], ...(form.variantTitle.trim() ? { variantTitle: form.variantTitle.trim() } : {}), ...(form.brand.trim() ? { brand: form.brand.trim() } : {}), ...(form.identifierValue.trim() ? { identifierType: form.identifierType, identifierValue: form.identifierValue.trim() } : {}), active: form.active };
    try {
      const response = selected
        ? await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body: JSON.stringify({ canonicalName: body.canonicalName, description: body.description, verticalId: body.verticalId, scope: body.scope, categoryIds: body.categoryIds, attributeValues: body.attributeValues, variantAttributeValues: updateVariantAttributes?.map((set) => ({ variantId: set.variantId, values: set.values ?? [] })), active: body.active, ...(body.brand ? { brand: body.brand } : {}) }) })
        : await fetch("/api/catalog/products", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      setSelected(payload.product); setForm(toForm(payload.product)); setAttributeDrafts(attributeDraftsFromValues(payload.product));
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
          <label>بحث الفئات<input disabled={!verticalFilter || filterCategoryLoading} value={filterCategoryQuery} onChange={(event) => setFilterCategoryQuery(event.target.value)} placeholder="اسم الفئة" /></label>
          <button type="button" className="button button-quiet" disabled={!verticalFilter || filterCategoryLoading} onClick={() => void searchFilterCategories()}>{filterCategoryLoading ? "جارٍ البحث…" : "بحث الفئات"}</button>
          <label>الفئة<select disabled={!verticalFilter} value={categoryFilter} onChange={(event) => { const categoryId = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId, active: statusFilter, sort }); setCategoryFilter(categoryId); }}><option value="">كل الفئات</option>{filterCategories.map((category) => <option value={category.id} key={category.id}>{category.pathAr}</option>)}</select></label>
          {filterCategoryNextCursor ? <button type="button" className="button button-quiet" disabled={filterCategoryLoading} onClick={() => void loadMoreFilterCategories()}>{filterCategoryLoading ? "جارٍ التحميل…" : "فئات إضافية"}</button> : null}
          <label>الحالة<select value={statusFilter} onChange={(event) => { const active = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active, sort }); setStatusFilter(active); }}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">معطل</option></select></label>
          <label>الترتيب<select value={sort} onChange={(event) => { const sort = event.target.value; writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setSort(sort); }}><option value="name_asc">الاسم أ–ي</option><option value="name_desc">الاسم ي–أ</option><option value="updated_desc">الأحدث تعديلًا</option><option value="updated_asc">الأقدم تعديلًا</option></select></label>
          <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          {query || appliedQuery ? <button type="button" className="button button-quiet" onClick={() => { writeCatalogLocation({ query: "", verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setQuery(""); setAppliedQuery(""); }}>مسح البحث</button> : null}
        </form>
        <div className="catalog-selection-bar" aria-live="polite"><span>{selectedIds.size ? `تم تحديد ${selectedIds.size} من هذه الصفحة` : `${products.length}${nextCursor ? "+" : ""} سجل في النتيجة الحالية`}</span>{selectedIds.size ? <button type="button" className="button button-quiet" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button> : null}</div>
        <div className="catalog-registry-table-wrap">
          <table className="catalog-registry-table">
            <thead><tr><th><input aria-label="تحديد جميع سجلات الصفحة" type="checkbox" checked={products.length > 0 && selectedIds.size === products.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(products.map((item) => item.id)) : new Set())} /></th><th>المنتج</th><th>المجال التجاري</th><th>الفئات</th><th>النسخ</th><th>متاجر تعرضه</th><th>الحالة</th><th>آخر تحديث</th><th>الإجراء</th></tr></thead>
            <tbody>
              {loading && products.length === 0 ? <tr><td colSpan={9} className="catalog-table-state">جارٍ قراءة السجل…</td></tr> : null}
              {!loading && products.length === 0 ? <tr><td colSpan={9} className="catalog-table-state">لا توجد منتجات مطابقة للفلاتر.</td></tr> : null}
              {products.map((product) => <tr key={product.id} className={selected?.id === product.id ? "is-open" : ""}>
                <td><input type="checkbox" aria-label={`تحديد ${product.canonicalName}`} checked={selectedIds.has(product.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} /></td>
                <td><div className="catalog-registry-product">{product.primaryImageUri ? <img className="catalog-registry-product-image" src={product.primaryImageUri} alt="" loading="lazy" /> : <span className="catalog-registry-product-placeholder" aria-hidden="true">{product.canonicalName.trim().slice(0, 1) || "•"}</span>}<span><strong>{product.canonicalName}</strong><small>{product.brand || product.id}</small></span></div></td>
                <td>{sharedVerticals.find((vertical) => vertical.id === product.verticalId)?.nameAr ?? product.verticalId}</td>
                <td>{product.categoryIds.length}</td><td>{product.variantCount}</td><td>{product.storeCount}</td>
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
          <label className="field-label" htmlFor="catalog-vertical">المجال التجاري<select id="catalog-vertical" disabled={busy || selected !== null} value={form.verticalId} onChange={(event) => { setForm({ ...form, verticalId: event.target.value, categoryIds: [] }); setCategorySearch(""); setCategoryNextCursor(""); setCategories([]); setSelectedCategoryDetails([]); setAttributeDrafts({}); }}><option value="">اختر المجال التجاري</option>{sharedVerticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
          <fieldset className="catalog-product-category-picker" disabled={busy || !form.verticalId} aria-describedby="catalog-category-help">
            <legend>الفئات المرتبطة بالمنتج</legend>
            <p id="catalog-category-help" className="muted">اختر فئة واحدة أو أكثر. الخصائص المطلوبة تتغير حسب الفئات المختارة.</p>
            <div className="catalog-category-filters"><label className="field-label" htmlFor="catalog-product-category-search">بحث الفئات<input id="catalog-product-category-search" type="search" maxLength={160} value={categorySearch} disabled={categoryLoading} onChange={(event) => setCategorySearch(event.target.value)} placeholder="اسم الفئة بالعربية أو الإنجليزية" /></label><button type="button" className="button button-secondary" disabled={categoryLoading} onClick={() => void searchProductCategories()}>{categoryLoading ? "جارٍ البحث…" : "بحث"}</button>{categoryNextCursor ? <button type="button" className="button button-quiet" disabled={categoryLoading} onClick={() => void loadMoreProductCategories()}>{categoryLoading ? "جارٍ التحميل…" : "تحميل فئات إضافية"}</button> : null}</div>
            {categoryLoading ? <p className="muted" role="status">جارٍ قراءة صفحة الفئات…</p> : null}
            {!form.verticalId ? <p className="muted">اختر المجال التجاري أولًا لقراءة فئاته.</p> : categoryChoices.length === 0 ? <p className="muted">{categorySearch ? "لا توجد فئات مطابقة." : "لا توجد فئات في المجال المحدد."}</p> : <ul className="catalog-product-category-list">
              {[...categoryChoices].sort((left, right) => left.pathAr.localeCompare(right.pathAr, "ar")).map((category) => {
                const checked = form.categoryIds.includes(category.id);
                const path = category.pathAr;
                const depth = Math.max(0, path.split(" / ").length - 1);
                return <li key={category.id} style={{ marginInlineStart: Math.min(depth, 8) * 16 } as CSSProperties}>
                  <label className={"catalog-product-category-option" + (category.active ? "" : " is-inactive")}>
                    <input type="checkbox" checked={checked} disabled={!category.active && !checked} onChange={() => toggleProductCategory(category.id)} />
                    <span><strong>{category.nameAr}</strong><small>{path}{category.active ? "" : " · متوقفة"}</small></span>
                  </label>
                </li>;
              })}
            </ul>}
            {form.categoryIds.length ? <p className="muted">المحدد: {form.categoryIds.map((id) => categoryPath(id, categoryChoices)).join("، ")}</p> : null}
          </fieldset>
          {attributeReadState === "loading" ? <p className="muted">جارٍ قراءة خصائص الفئات المحددة…</p> : attributeReadState === "error" ? <p className="identity-error" role="alert">تعذرت قراءة قواعد الخصائص. أعد المحاولة قبل الحفظ.</p> : renderAttributeFields()}
          {form.scope === "STORE_SCOPED" ? <p className="muted">هذا المنتج خاص بمتجر ويُدار من مساحة المتجر.</p> : null}
          <label className="field-label" htmlFor="catalog-product-name">الاسم القياسي<input id="catalog-product-name" disabled={busy} value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-product-description">الوصف القياسي<textarea id="catalog-product-description" disabled={busy} maxLength={4000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-product-brand">العلامة<input id="catalog-product-brand" disabled={busy} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-variant-title">عنوان النسخة<input id="catalog-variant-title" disabled={busy || selected !== null} value={form.variantTitle} onChange={(event) => setForm({ ...form, variantTitle: event.target.value })} placeholder="الافتراضي" /></label>
          <label className="field-label" htmlFor="catalog-measurement-kind">سياسة القياس<select id="catalog-measurement-kind" disabled={busy || selected !== null} value={form.measurementKind} onChange={(event) => { const measurementKind = event.target.value as MeasurementKind; setForm({ ...form, measurementKind, baseUnit: measurementKind === "DISCRETE" ? "COUNT" : form.baseUnit === "COUNT" ? "GRAM" : form.baseUnit }); }}><option value="DISCRETE">عددي</option><option value="MEASURED">مقاس ثابت</option><option value="VARIABLE_MEASURE">مقاس متغير</option></select></label>
          <label className="field-label" htmlFor="catalog-base-unit">الوحدة الأساسية<select id="catalog-base-unit" disabled={busy || selected !== null} value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value as BaseUnit })}><option value="COUNT">قطعة</option><option value="GRAM">غرام</option><option value="MILLILITER">مل</option></select></label>
          <label className="field-label" htmlFor="catalog-identifier">نوع المعرّف<input id="catalog-identifier" disabled={busy || selected !== null} value={form.identifierType} onChange={(event) => setForm({ ...form, identifierType: event.target.value.toUpperCase() })} /></label>
          <label className="field-label" htmlFor="catalog-identifier-value">قيمة المعرّف<input id="catalog-identifier-value" disabled={busy || selected !== null} value={form.identifierValue} onChange={(event) => setForm({ ...form, identifierValue: event.target.value })} /></label>
          {selected ? <><p className="muted">الصور محفوظة في مخزن الوسائط المركزي ومربوطة بالمنتج بعد الرفع.</p><div className="catalog-product-media-gallery">{[...selected.media].sort((left, right) => left.ordinal - right.ordinal).map((media) => <figure key={`${media.role}:${media.ordinal}:${media.uri}`}><img className="catalog-media-preview" src={media.uri} alt={`${media.role === "primary" ? "الصورة الأساسية" : "صورة المعرض"} لمنتج ${form.canonicalName}`} loading="lazy" /><figcaption>{media.role === "primary" ? "الصورة الأساسية" : `صورة المعرض ${media.ordinal}`}</figcaption></figure>)}{selected.media.length === 0 ? <p className="muted">لا توجد صور بعد. أنشئ المنتج أولًا ثم ارفع صورته هنا.</p> : null}</div><div className="catalog-media-upload"><label className="field-label" htmlFor="catalog-upload-role">موضع الصورة<select id="catalog-upload-role" disabled={busy} value={uploadRole} onChange={(event) => setUploadRole(event.target.value as "primary" | "gallery")}><option value="primary">الصورة الأساسية</option><option value="gallery">المعرض</option></select></label><label className="field-label" htmlFor="catalog-upload-file">ملف الصورة<input key={uploadInputKey} id="catalog-upload-file" disabled={busy} type="file" accept="image/jpeg,image/png" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="button button-secondary" disabled={busy || !uploadFile} onClick={() => void uploadMedia()}>رفع الصورة وربطها</button></div></> : <p className="muted">بعد حفظ المنتج، افتح تفاصيله لإرفاق صورة من خلال مخزن الوسائط.</p>}
          {selected ? <label className="central-active-toggle"><input type="checkbox" disabled={busy} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> المنتج نشط وقابل للاختيار</label> : null}
          <button type="button" className="button button-primary" disabled={busy || form.scope !== "SHARED" || attributeReadState !== "ready" || !form.canonicalName.trim() || !form.verticalId || form.categoryIds.length === 0} onClick={() => void saveProduct()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إنشاء المنتج"}</button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => { writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); detailRequestSequence.current += 1; setDetailLoading(false); setEditorOpen(false); setSelected(null); }}>إغلاق التفاصيل</button>
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
      </section> : null}
    </div>
  );
}
