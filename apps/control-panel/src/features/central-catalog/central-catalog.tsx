"use client";
import { TextArea } from "@bthwani/design-system/web";
import { useRouter } from "next/navigation";
import { type BaseUnit, type CatalogAttributeRule, type CatalogAttributeValue, type CatalogAttributeValueInput, type CatalogCategoryListItem, type CatalogCategoryListResponse, type CatalogProduct, type CatalogProductRegistryResponse, type CatalogVariant, type CommerceVertical, isMediaProvenanceInputValid, type MeasurementKind, type MediaProvenanceInput } from "@bthwani/dsh";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { ActivityIndicator, ActivityLegend } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { appendMediaProvenance, CatalogMediaProvenanceFields } from "./catalog-media-provenance-fields";

type ProductForm = { verticalId: string; scope: "SHARED" | "STORE_SCOPED"; canonicalName: string; description: string; brand: string; variantTitle: string; measurementKind: MeasurementKind; baseUnit: BaseUnit; categoryIds: ReadonlyArray<string>; identifierType: string; identifierValue: string; active: boolean };

const emptyForm: ProductForm = { verticalId: "", scope: "SHARED", canonicalName: "", description: "", brand: "", variantTitle: "", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryIds: [], identifierType: "GTIN", identifierValue: "", active: true };
type AttributeDrafts = Readonly<Record<string, string>>;
type CatalogLocationState = Readonly<{ query: string; verticalId: string; categoryId: string; active: string; sort: string; mode?: "create" | "edit"; productId?: string }>;

function writeCatalogLocation(state: CatalogLocationState, resetCursor = false) {
  const url = new URL(window.location.href);
  for (const key of ["q", "verticalId", "categoryId", "active", "sort", "mode", "productId"]) url.searchParams.delete(key);
  if (resetCursor) url.searchParams.delete("productCursor");
  if (state.query) url.searchParams.set("q", state.query);
  if (state.verticalId) url.searchParams.set("verticalId", state.verticalId);
  if (state.categoryId) url.searchParams.set("categoryId", state.categoryId);
  if (state.active !== "all") url.searchParams.set("active", state.active);
  if (state.sort !== "name_asc") url.searchParams.set("sort", state.sort);
  if (state.mode) url.searchParams.set("mode", state.mode);
  if (state.productId) url.searchParams.set("productId", state.productId);
  const href = `${url.pathname}${url.search}${url.hash}`;
  window.history.pushState({ ...window.history.state, catalogRegistry: true }, "", href);
  return href;
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

function isRenderableRegistryProduct(value: unknown): value is CatalogProductRegistryResponse["products"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  return typeof product.id === "string" && product.id.length > 0
    && typeof product.canonicalName === "string" && product.canonicalName.trim().length > 0
    && typeof product.verticalId === "string"
    && Array.isArray(product.categoryIds) && product.categoryIds.every((id: unknown) => typeof id === "string")
    && (product.categoryNamesAr === undefined || (Array.isArray(product.categoryNamesAr) && product.categoryNamesAr.every((name: unknown) => typeof name === "string")))
    && typeof product.active === "boolean"
    && Number.isSafeInteger(product.variantCount) && (product.variantCount as number) >= 0
    && Number.isSafeInteger(product.storeCount) && (product.storeCount as number) >= 0
    && typeof product.updatedAt === "string" && Number.isFinite(Date.parse(product.updatedAt))
    && (product.brand == null || typeof product.brand === "string")
    && (product.primaryImageUri == null || typeof product.primaryImageUri === "string");
}

function ProductGalleryImage({ uri, name }: { uri: string | null | undefined; name: string }) {
  const [failedUri, setFailedUri] = useState("");
  if (!uri || uri === failedUri) return <span className="catalog-gallery-no-image" role="img" aria-label={`لا توجد صورة متاحة لمنتج ${name}`}>لا توجد صورة</span>;
  return <img className="catalog-gallery-thumbnail" src={uri} alt={`الصورة الأساسية لمنتج ${name}`} loading="lazy" onError={() => setFailedUri(uri)} />;
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
  const router = useRouter();
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(false);
  const [sort, setSort] = useState("name_asc");
  const [viewMode, setViewMode] = useState<"table" | "gallery">("table");
  const [minVariants, setMinVariants] = useState("");
  const [minStores, setMinStores] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const orderedMedia = useMemo(() => [...(selected?.media ?? [])].sort((left, right) => left.ordinal - right.ordinal), [selected]);
  const previewMedia = previewIndex === null ? undefined : orderedMedia[previewIndex];
  const previewAlt = previewMedia ? `${previewMedia.role === "primary" ? "الصورة الأساسية" : `صورة المعرض ${previewMedia.ordinal}`} لمنتج ${selected?.canonicalName}` : "";
  const [failedPreviewUri, setFailedPreviewUri] = useState("");
  const previewDialogRef = useRef<HTMLDialogElement | null>(null);
  const previewOriginRef = useRef<HTMLElement | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailProductId, setDetailProductId] = useState("");
  const [versionConflict, setVersionConflict] = useState(false);
  const saveAttempt = useRef<{ intent: string; key: string } | null>(null);
  const mediaAttempt = useRef<{ file: File; intent: string; key: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [registrySummary, setRegistrySummary] = useState<{ totalCount: number; measuredAt: string } | null>(null);
  const [registryError, setRegistryError] = useState("");
  const cursorPage = useCursorPage("productCursor", JSON.stringify([appliedQuery, verticalFilter, categoryFilter, statusFilter, sort, minVariants, minStores]));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadRole, setUploadRole] = useState<"primary" | "gallery">("primary");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProvenance, setUploadProvenance] = useState<MediaProvenanceInput>({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const categoryRequestSequence = useRef(0);
  const filterCategoryRequestSequence = useRef(0);
  const sharedVerticals = verticals.filter((vertical) => vertical.active);
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
    setFilterCategoryLoading(true);
    try {
      const params = new URLSearchParams({ verticalId: verticalFilter, status: "active", sort: "name_asc", limit: "25" });
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

  async function loadMoreFilterCategories() {
    if (!filterCategoryNextCursor || filterCategoryLoading) return;
    try { await loadFilterCategories(filterCategoryQuery, filterCategoryNextCursor, true); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "تعذر تحميل فئات إضافية."); }
  }
  const load = useCallback(async (cursor = cursorPage.cursor) => {
    const requestSequence = ++listRequestSequence.current;
    setLoading(true);
    setRegistrySummary(null);
    setRegistryError("");
    try {
      const suffix = new URLSearchParams({ limit: "50", active: statusFilter, sort });
      if (appliedQuery.trim()) suffix.set("q", appliedQuery.trim());
      if (verticalFilter) suffix.set("verticalId", verticalFilter);
      if (categoryFilter) suffix.set("categoryId", categoryFilter);
      if (minVariants.trim()) suffix.set("minVariantCount", minVariants.trim());
      if (minStores.trim()) suffix.set("minStoreCount", minStores.trim());
      if (cursor) suffix.set("cursor", cursor);
      const response = await fetch(`/api/catalog/product-registry?${suffix.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const payload = await parseResponse<CatalogProductRegistryResponse>(response);
      if (requestSequence !== listRequestSequence.current) return;
      if (!Array.isArray(payload?.products) || !payload.products.every(isRenderableRegistryProduct)
        || (payload.nextCursor !== undefined && typeof payload.nextCursor !== "string")) throw new Error("استجابة سجل المنتجات غير صالحة. أعد القراءة.");
      if (payload.totalCount !== undefined && (!Number.isSafeInteger(payload.totalCount) || payload.totalCount < payload.products.length || !Number.isFinite(Date.parse(payload.measuredAt)))) throw new Error("تعذر التحقق من ملخص المنتجات. أعد القراءة.");
      setRegistrySummary(payload.totalCount === undefined ? null : { totalCount: payload.totalCount, measuredAt: payload.measuredAt });
      setProducts(payload.products);
      setNextCursor(payload.nextCursor ?? "");
    } catch (nextError) {
      if (requestSequence === listRequestSequence.current) { setRegistryError(nextError instanceof Error ? nextError.message : "تعذر قراءة الكتالوج."); setProducts([]); setNextCursor(""); }
    } finally {
      if (requestSequence === listRequestSequence.current) setLoading(false);
    }
  }, [appliedQuery, verticalFilter, categoryFilter, statusFilter, sort, minVariants, minStores, cursorPage.cursor]);
  useReadOnReturn(() => load(cursorPage.cursor), cursorPage.ready && !editorOpen && !loading && !busy);

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
  useEffect(() => { if (cursorPage.ready) void load(); }, [load, cursorPage.ready]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadFilterCategories(filterCategoryQuery).catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الفئات."));
    }, 250);
    return () => { clearTimeout(timer); filterCategoryRequestSequence.current += 1; };
  }, [filterCategoryQuery, loadFilterCategories]);
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

  function changeFilters(location: CatalogLocationState) {
    cursorPage.clearForNavigation();
    const href = writeCatalogLocation(location, true);
    router.replace(href, { scroll: false });
  }

  function clearProductPageCursor() {
    cursorPage.clearForNavigation();
    const url = new URL(window.location.href);
    if (!url.searchParams.has("productCursor")) return;
    url.searchParams.delete("productCursor");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function closePreview() {
    previewDialogRef.current?.close();
    setPreviewIndex(null);
    previewOriginRef.current?.focus();
  }

  function openPreview(index: number) {
    previewOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreviewIndex(index);
  }

  useEffect(() => {
    if (!previewMedia) return;
    const dialog = previewDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [previewMedia]);

  function closeEditor() {
    writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort });
    detailRequestSequence.current += 1;
    setDetailLoading(false); setDetailProductId(""); setVersionConflict(false); setEditorOpen(false); setSelected(null); setPreviewIndex(null);
  }

  function changeView(nextView: "table" | "gallery") {
    if (viewMode === nextView) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.pushState({ ...window.history.state, catalogRegistry: true }, "", `${url.pathname}${url.search}${url.hash}`);
    setViewMode(nextView);
  }

  async function selectProduct(productId: string, updateLocation = true) {
    setPreviewIndex(null);
    setDetailProductId(productId); setVersionConflict(false);
    const requestSequence = ++detailRequestSequence.current;
    setConfirmDelete(false); setDeleteReason("");
    if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "edit", productId });
    setDetailLoading(true); setSelected(null); setEditorOpen(true); setNotice(""); setError("");
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(productId)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const detail = await parseResponse<CatalogProduct>(response);
      if (requestSequence !== detailRequestSequence.current) return false;
      if (!detail || detail.id !== productId || !Array.isArray(detail.categoryIds) || !Array.isArray(detail.variants) || !Array.isArray(detail.attributes) || !Array.isArray(detail.media)) throw new Error("استجابة تفاصيل المنتج غير صالحة. أعد القراءة.");
      setSelected(detail); setForm(toForm(detail)); setAttributeDrafts(attributeDraftsFromValues(detail)); setAdvancedOpen(true); setUploadFile(null); setUploadRole("primary");
      return true;
    } catch (nextError) { if (requestSequence === detailRequestSequence.current) setError(nextError instanceof Error ? nextError.message : "تعذر قراءة تفاصيل المنتج."); return false; }
    finally { if (requestSequence === detailRequestSequence.current) setDetailLoading(false); }
  }
  function startCreate(updateLocation = true) { setDetailProductId(""); setVersionConflict(false); saveAttempt.current = null; setPreviewIndex(null); detailRequestSequence.current += 1; if (updateLocation) writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "create" }); setDetailLoading(false); setSelected(null); setEditorOpen(true); setForm(emptyForm); setAttributeDrafts({}); setAdvancedOpen(false); setUploadFile(null); setUploadRole("primary"); setNotice(""); setError(""); }

  const restoreCatalogLocation = useEffectEvent(() => {
    const params = new URL(window.location.href).searchParams;
    const nextQuery = params.get("q") ?? "";
    const nextVertical = params.get("verticalId") ?? "";
    const nextCategory = params.get("categoryId") ?? "";
    const nextActive = params.get("active") ?? "all";
    const nextSort = params.get("sort") ?? "name_asc";
    setQuery(nextQuery); setAppliedQuery(nextQuery); setVerticalFilter(nextVertical); setCategoryFilter(nextCategory); setStatusFilter(nextActive); setSort(nextSort);
    const requestedView = params.get("view");
    setViewMode(requestedView === "gallery" || requestedView === "table" ? requestedView : "table");
    const mode = params.get("mode");
    const productId = params.get("productId");
    if (mode === "edit" && productId) { if (selected?.id !== productId || !editorOpen) void selectProduct(productId, false); }
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
      let valueInput: ReactNode;
      if (rule.valueKind === "BOOLEAN") {
        valueInput = <select id={fieldId} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر قيمة</option><option value="true">نعم</option><option value="false">لا</option></select>;
      } else if (rule.valueKind === "ENUM") {
        valueInput = <select id={fieldId} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))}><option value="">اختر قيمة</option>{(enumOptions[rule.attributeId] ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>;
      } else {
        let inputMode: "text" | "decimal" = "text";
        if (rule.valueKind === "INTEGER" || rule.valueKind === "DECIMAL" || rule.valueKind === "MEASUREMENT") inputMode = "decimal";
        valueInput = <input id={fieldId} inputMode={inputMode} value={attributeDrafts[key] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key]: event.target.value }))} />;
      }
      return <label className="field-label" htmlFor={fieldId} key={fieldId}>
        {rule.nameAr}{rule.required ? " · مطلوب" : " · اختياري"}{rule.variantAxis ? " · خاص بالنسخة" : ""}
        {valueInput}
        {rule.valueKind === "MEASUREMENT" ? <input aria-label={`وحدة ${rule.nameAr}`} placeholder="وحدة القياس" value={attributeDrafts[key + ":unit"] ?? ""} onChange={(event) => setAttributeDrafts((current) => ({ ...current, [key + ":unit"]: event.target.value }))} /> : null}
      </label>;
    }
    const productRules = attributeRules.filter((rule) => !rule.variantAxis);
    const variantRules = attributeRules.filter((rule) => rule.variantAxis);
    let variantAttributeFields: ReactNode = null;
    if (variantRules.length > 0) {
      if (selected?.variants.length) {
        variantAttributeFields = selected.variants.map((variant) => <fieldset className="catalog-variant-attributes" key={variant.id}><legend>{variant.title}</legend>{variantRules.map((rule) => renderField(rule, variant.id))}</fieldset>);
      } else {
        variantAttributeFields = <fieldset className="catalog-variant-attributes"><legend>النسخة الافتراضية</legend>{variantRules.map((rule) => renderField(rule, "new"))}</fieldset>;
      }
    }
    return <section className="managed-status managed-status-info" aria-label="خصائص الفئة">
      <strong>خصائص المنتجات حسب الفئات المختارة</strong>
      {productRules.map((rule) => renderField(rule))}
      {variantAttributeFields}
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
    if (busy || detailLoading || versionConflict || (detailProductId && !selected) || form.scope !== "SHARED" || !form.canonicalName.trim() || !form.verticalId || form.categoryIds.length === 0) return;
    if (attributeReadState !== "ready") { setError("تعذر التحقق من خصائص الفئات. أعد قراءة القواعد قبل الحفظ."); return; }
    const productAttributes = buildAttributeValues(attributeRules, attributeDrafts);
    const createVariantAttributes = selected ? null : buildAttributeValues(attributeRules, attributeDrafts, "new");
    const updateVariantAttributes = selected ? selected.variants.map((variant) => ({ variantId: variant.id, values: buildAttributeValues(attributeRules, attributeDrafts, variant.id) })) : null;
    if (!productAttributes || (!selected && !createVariantAttributes) || (selected && (!updateVariantAttributes?.length || updateVariantAttributes.some((set) => set.values === null)))) { setError("أكمل الخصائص المطلوبة لكل نسخة وتحقق من أنواع القيم قبل الحفظ."); return; }
    setBusy(true); setError(""); setNotice("");
    const body = { canonicalName: form.canonicalName.trim(), description: form.description.trim(), verticalId: form.verticalId, scope: "SHARED" as const, measurementKind: form.measurementKind, baseUnit: form.baseUnit, categoryIds: [...form.categoryIds], attributeValues: productAttributes, variantAttributeValues: createVariantAttributes ?? [], ...(form.variantTitle.trim() ? { variantTitle: form.variantTitle.trim() } : {}), ...(form.brand.trim() ? { brand: form.brand.trim() } : {}), ...(form.identifierValue.trim() ? { identifierType: form.identifierType, identifierValue: form.identifierValue.trim() } : {}), active: form.active };
    const intent = JSON.stringify({ productId: selected?.id, version: selected?.version, body, updateVariantAttributes });
    if (saveAttempt.current?.intent !== intent) saveAttempt.current = { intent, key: crypto.randomUUID() };
    const idempotencyKey = saveAttempt.current.key;
    try {
      const response = selected
        ? await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "POST", signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, "X-Expected-Version": String(selected.version) }, body: JSON.stringify({ canonicalName: body.canonicalName, description: body.description, verticalId: body.verticalId, scope: body.scope, categoryIds: body.categoryIds, attributeValues: body.attributeValues, variantAttributeValues: updateVariantAttributes?.map((set) => ({ variantId: set.variantId, values: set.values ?? [] })), active: body.active, ...(body.brand ? { brand: body.brand } : {}) }) })
        : await fetch("/api/catalog/products", { method: "POST", signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      if (!payload?.product?.id) throw new Error("أُرسل الحفظ لكن تعذر تأكيد نتيجته. أعد المحاولة بنفس البيانات.");
      writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort, mode: "edit", productId: payload.product.id });
      saveAttempt.current = null;
      if (await selectProduct(payload.product.id, false)) { setNotice(selected ? "تم تحديث المنتج." : "تم إنشاء المنتج والنسخة الافتراضية."); await load(); }
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setVersionConflict(Boolean(selected));
        setError("تغير المنتج قبل حفظك. احتفظنا بتعديلاتك في النموذج؛ حمّل النسخة الحالية عند الاستعداد لإلغاء هذه التعديلات ومراجعة السجل.");
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر حفظ المنتج.");
      }
    } finally { setBusy(false); }
  }

  async function trashSelected() {
    if (!selected || busy || versionConflict || Array.from(deleteReason.trim()).length < 5) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/catalog/trash/" + encodeURIComponent(selected.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Expected-Version": String(selected.version), "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "trash", reason: deleteReason.trim() }),
      });
      await parseResponse(response);
      setConfirmDelete(false); setDeleteReason(""); setSelected(null); setEditorOpen(false);
      writeCatalogLocation({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort });
      setNotice("نُقل المنتج إلى سلة المحذوفات، ويمكن استعادته من صفحة السلة.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر نقل المنتج إلى السلة.");
      if (cause && typeof cause === "object" && (cause as { status?: number }).status === 409) {
        setVersionConflict(true); setConfirmDelete(false);
        setError("تغير المنتج قبل نقله إلى السلة. احتفظنا بتعديلاتك؛ حمّل النسخة الحالية لمراجعة السجل قبل إعادة المحاولة.");
      }
    } finally { setBusy(false); }
  }

  async function uploadMedia() {
    if (!selected || !uploadFile || busy || versionConflict || !isMediaProvenanceInputValid(uploadProvenance)) return;
    setBusy(true); setError(""); setNotice("");
    const body = new FormData();
    body.set("role", uploadRole);
    body.set("file", uploadFile, uploadFile.name);
    appendMediaProvenance(body, uploadProvenance);
    const intent = JSON.stringify({ productId: selected.id, version: selected.version, role: uploadRole, provenance: uploadProvenance });
    if (mediaAttempt.current?.file !== uploadFile || mediaAttempt.current.intent !== intent) mediaAttempt.current = { file: uploadFile, intent, key: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}/media`, { method: "POST", headers: { "Idempotency-Key": mediaAttempt.current.key, "X-Expected-Version": String(selected.version) }, body, signal: AbortSignal.timeout(30_000) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      if (payload?.product?.id !== selected.id || !Array.isArray(payload.product.media)) throw new Error("أُرسل رفع الصورة لكن تعذر تأكيد نتيجته. أعد المحاولة بنفس الملف والبيانات.");
      mediaAttempt.current = null;
      setSelected(payload.product); setUploadFile(null); setUploadProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false }); setUploadInputKey((value) => value + 1); setNotice(uploadRole === "primary" ? "تم رفع الصورة الأساسية وربطها بالمنتج." : "تم رفع الصورة وإضافتها إلى المعرض.");
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setVersionConflict(true);
        setError("تغير المنتج قبل رفع الصورة. احتفظنا بتعديلاتك والملف؛ حمّل النسخة الحالية عند الاستعداد لإلغاء هذه التعديلات ومراجعة السجل.");
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر رفع صورة المنتج.");
      }
    } finally { setBusy(false); }
  }

  let categoryPickerContent: ReactNode;
  if (!form.verticalId) {
    categoryPickerContent = <p className="muted">اختر المجال التجاري أولًا لقراءة فئاته.</p>;
  } else if (categoryChoices.length === 0) {
    const emptyCategoryMessage = categorySearch ? "لا توجد فئات مطابقة." : "لا توجد فئات في المجال المحدد.";
    categoryPickerContent = <p className="muted">{emptyCategoryMessage}</p>;
  } else {
    categoryPickerContent = <ul className="catalog-product-category-list">
      {[...categoryChoices].sort((left, right) => left.pathAr.localeCompare(right.pathAr, "ar")).map((category) => {
        const checked = form.categoryIds.includes(category.id);
        const path = category.pathAr;
        const depth = Math.max(0, path.split(" / ").length - 1);
        return <li key={category.id} className="catalog-tree-entry" style={{ "--tree-depth": Math.min(depth, 8) } as CSSProperties}>
          <label className={"catalog-product-category-option" + (category.active ? "" : " is-inactive")}>
            <input type="checkbox" checked={checked} disabled={!category.active && !checked} onChange={() => toggleProductCategory(category.id)} />
            <span><strong>{category.nameAr}</strong><small>{path}{category.active ? "" : " · متوقفة"}</small></span>
          </label>
        </li>;
      })}
    </ul>;
  }

  let attributeEditorContent: ReactNode;
  if (attributeReadState === "loading") {
    attributeEditorContent = <p className="muted">جارٍ قراءة خصائص الفئات المحددة…</p>;
  } else if (attributeReadState === "error") {
    attributeEditorContent = <p className="identity-error" role="alert">تعذرت قراءة قواعد الخصائص. أعد المحاولة قبل الحفظ.</p>;
  } else {
    attributeEditorContent = renderAttributeFields();
  }

  const activeFilterCount = [verticalFilter, categoryFilter, statusFilter !== "all", sort !== "name_asc", minVariants, minStores].filter(Boolean).length;
  const hasCatalogFilters = activeFilterCount > 0 || Boolean(query || appliedQuery);

  let saveProductLabel = "إنشاء المنتج";
  if (selected) saveProductLabel = "حفظ التعديل";
  if (busy) saveProductLabel = "جارٍ الحفظ…";

  const selectedProductIndex = products.findIndex((product) => product.id === selected?.id);
  const saveProductDisabled = busy || versionConflict || detailLoading || form.scope !== "SHARED" || attributeReadState !== "ready" || !form.canonicalName.trim() || !form.verticalId || form.categoryIds.length === 0 || confirmDelete;
  const editorActions = editorOpen && (selected || !detailProductId) ? <div className="catalog-product-panel-actions">
    {selected && !confirmDelete ? <button type="button" className="button button-secondary" disabled={busy || versionConflict} onClick={() => { setConfirmDelete(true); setDeleteReason(""); }}>نقل إلى سلة المحذوفات</button> : null}
    <button type="button" className="button button-primary" disabled={saveProductDisabled} onClick={() => void saveProduct()}>{saveProductLabel}</button>
  </div> : null;
  const editorDetail = editorOpen ? <AdaptiveRecordPanel
    title={selected ? "ملف المنتج" : "منتج جديد"}
    subtitle={selected ? selected.canonicalName : "إضافة منتج إلى الكتالوج المشترك"}
    onClose={closeEditor}
    onPrevious={selectedProductIndex > 0 ? () => { const product = products[selectedProductIndex - 1]; if (product) void selectProduct(product.id); } : undefined}
    onNext={selectedProductIndex >= 0 && selectedProductIndex < products.length - 1 ? () => { const product = products[selectedProductIndex + 1]; if (product) void selectProduct(product.id); } : undefined}
    actions={editorActions}
  >
    {detailProductId && !selected ? <section className="access-card central-catalog-editor" aria-labelledby="central-catalog-editor-title">
      <h2 id="central-catalog-editor-title">ملف المنتج</h2>
      {detailLoading ? <p role="status">جارٍ قراءة التفاصيل والعلاقات من الخادم…</p> : <p className="identity-error" role="alert">{error || "تعذرت قراءة تفاصيل المنتج. أعد المحاولة."}</p>}
      <div className="action-row"><button type="button" className="button button-secondary" disabled={detailLoading} onClick={() => void selectProduct(detailProductId, false)}>إعادة قراءة المنتج</button></div>
    </section> : <section className="access-card central-catalog-editor" aria-labelledby="central-catalog-editor-title">
      {detailLoading ? <p className="muted" role="status">جارٍ قراءة التفاصيل والعلاقات من الخادم…</p> : null}
      <div className="access-card-heading"><h2 id="central-catalog-editor-title">بيانات المنتج</h2></div>
      <div className="central-product-form">
        <label className="field-label" htmlFor="catalog-vertical">المجال التجاري<select id="catalog-vertical" disabled={busy || selected !== null} value={form.verticalId} onChange={(event) => { setForm({ ...form, verticalId: event.target.value, categoryIds: [] }); setCategorySearch(""); setCategoryNextCursor(""); setCategories([]); setSelectedCategoryDetails([]); setAttributeDrafts({}); }}><option value="">اختر المجال التجاري</option>{sharedVerticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-product-name">الاسم القياسي<input id="catalog-product-name" disabled={busy} value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} /></label>
        <label className="field-label" htmlFor="catalog-product-description">الوصف القياسي<TextArea className="resize-none" id="catalog-product-description" disabled={busy} maxLength={4000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <fieldset className="catalog-product-category-picker" disabled={busy || !form.verticalId} aria-describedby="catalog-category-help">
          <legend>الفئات المرتبطة بالمنتج</legend>
          <p id="catalog-category-help" className="muted">اختر فئة واحدة أو أكثر. الخصائص المطلوبة تتغير حسب الفئات المختارة.</p>
          <div className="catalog-category-filters"><label className="field-label" htmlFor="catalog-product-category-search">بحث الفئات<input id="catalog-product-category-search" type="search" maxLength={160} value={categorySearch} disabled={categoryLoading} onChange={(event) => setCategorySearch(event.target.value)} placeholder="اسم الفئة بالعربية أو الإنجليزية" /></label><button type="button" className="button button-secondary" disabled={categoryLoading} onClick={() => void searchProductCategories()}>{categoryLoading ? "جارٍ البحث…" : "بحث"}</button>{categoryNextCursor ? <button type="button" className="button button-quiet" disabled={categoryLoading} onClick={() => void loadMoreProductCategories()}>{categoryLoading ? "جارٍ التحميل…" : "تحميل فئات إضافية"}</button> : null}</div>
          {categoryLoading ? <p className="muted" role="status">جارٍ قراءة صفحة الفئات…</p> : null}
          {categoryPickerContent}
          {form.categoryIds.length ? <p className="muted">المحدد: {form.categoryIds.map((id) => categoryPath(id, categoryChoices)).join("، ")}</p> : null}
        </fieldset>
        {attributeEditorContent}
        {form.scope === "STORE_SCOPED" ? <p className="muted">هذا المنتج خاص بمتجر ويُدار من مساحة المتجر.</p> : null}
        <details className="catalog-product-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
          <summary>بيانات إضافية للمنتج (اختيارية)</summary>
          <div className="catalog-product-advanced-fields">
            <label className="field-label" htmlFor="catalog-product-brand">العلامة<input id="catalog-product-brand" disabled={busy} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
            <label className="field-label" htmlFor="catalog-variant-title">عنوان النسخة<input id="catalog-variant-title" disabled={busy || selected !== null} value={form.variantTitle} onChange={(event) => setForm({ ...form, variantTitle: event.target.value })} placeholder="الافتراضي" /></label>
            <label className="field-label" htmlFor="catalog-measurement-kind">سياسة القياس<select id="catalog-measurement-kind" disabled={busy || selected !== null} value={form.measurementKind} onChange={(event) => { const measurementKind = event.target.value as MeasurementKind; let baseUnit = form.baseUnit; if (measurementKind === "DISCRETE") baseUnit = "COUNT"; else if (form.baseUnit === "COUNT") baseUnit = "GRAM"; setForm({ ...form, measurementKind, baseUnit }); }}><option value="DISCRETE">عددي</option><option value="MEASURED">مقاس ثابت</option><option value="VARIABLE_MEASURE">مقاس متغير</option></select></label>
            <label className="field-label" htmlFor="catalog-base-unit">الوحدة الأساسية<select id="catalog-base-unit" disabled={busy || selected !== null} value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value as BaseUnit })}><option value="COUNT">قطعة</option><option value="GRAM">غرام</option><option value="MILLILITER">مل</option></select></label>
            <label className="field-label" htmlFor="catalog-identifier">نوع الباركود أو رمز الصنف<select id="catalog-identifier" disabled={busy || selected !== null} value={form.identifierType} onChange={(event) => setForm({ ...form, identifierType: event.target.value })}><option value="GTIN">رقم المنتج العالمي</option><option value="EAN">باركود أوروبي</option><option value="UPC">باركود أمريكي</option><option value="SKU">رمز الصنف لدى المتجر</option><option value="LEGACY_BARCODE">باركود قديم</option></select></label>
            <label className="field-label" htmlFor="catalog-identifier-value">الباركود أو رمز الصنف<input id="catalog-identifier-value" disabled={busy || selected !== null} value={form.identifierValue} onChange={(event) => setForm({ ...form, identifierValue: event.target.value })} /></label>
          </div>
        </details>
        {selected ? <><div className="catalog-product-media-gallery">{orderedMedia.map((media, mediaIndex) => <figure key={media.role + ":" + media.ordinal + ":" + media.uri}><button type="button" className="catalog-media-preview-button" onClick={() => openPreview(mediaIndex)} aria-label={"تكبير " + (media.role === "primary" ? "الصورة الأساسية" : "صورة المعرض") + " لمنتج " + form.canonicalName}><img className="catalog-media-preview" src={media.uri} alt={(media.role === "primary" ? "الصورة الأساسية" : "صورة المعرض") + " لمنتج " + form.canonicalName} loading="lazy" /></button><figcaption>{media.role === "primary" ? "الصورة الأساسية" : "صورة المعرض " + media.ordinal}</figcaption></figure>)}{selected.media.length === 0 ? <p className="muted">لا توجد صور بعد. أنشئ المنتج أولًا ثم ارفع صورته هنا.</p> : null}</div><div className="catalog-media-upload"><label className="field-label" htmlFor="catalog-upload-role">موضع الصورة<select id="catalog-upload-role" disabled={busy} value={uploadRole} onChange={(event) => setUploadRole(event.target.value as "primary" | "gallery")}><option value="primary">الصورة الأساسية</option><option value="gallery">المعرض</option></select></label><label className="field-label" htmlFor="catalog-upload-file">ملف الصورة<input key={uploadInputKey} id="catalog-upload-file" disabled={busy} type="file" accept="image/jpeg,image/png" onChange={(event) => { setUploadFile(event.target.files?.[0] ?? null); setUploadProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false }); }} /></label><CatalogMediaProvenanceFields idPrefix="catalog-product-media" disabled={busy} value={uploadProvenance} onChange={setUploadProvenance} /><button type="button" className="button button-secondary" disabled={busy || versionConflict || !uploadFile || !isMediaProvenanceInputValid(uploadProvenance)} onClick={() => void uploadMedia()}>رفع الصورة وربطها</button></div></> : <p className="muted">بعد حفظ المنتج، افتح تفاصيله لإرفاق صورة من خلال مخزن الوسائط.</p>}
        {selected ? <label className="central-active-toggle"><input type="checkbox" disabled={busy} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> المنتج نشط وقابل للاختيار</label> : null}
        {versionConflict && !error ? <p className="identity-error" role="alert">تغير المنتج. احتفظنا بتعديلاتك؛ تحميل النسخة الحالية يلغي التعديلات والملف المحدد.</p> : null}
        {versionConflict && selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void selectProduct(selected.id, false)}>تحميل النسخة الحالية وإلغاء تعديلاتي</button> : null}
        {selected && confirmDelete ? <div className="catalog-category-filters"><span className="muted">تأكيد نقل المنتج إلى السلة</span><label className="field-label" htmlFor="catalog-delete-reason">سبب الحذف<input id="catalog-delete-reason" value={deleteReason} maxLength={500} disabled={busy} onChange={(event) => setDeleteReason(event.target.value)} placeholder="سبب واضح من 5 أحرف على الأقل" /></label><button type="button" className="button button-primary" disabled={busy || versionConflict || Array.from(deleteReason.trim()).length < 5} onClick={() => void trashSelected()}>{busy ? "جارٍ النقل…" : "تأكيد النقل إلى السلة"}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>إلغاء</button></div> : null}
      </div>
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
    </section>}
  </AdaptiveRecordPanel> : null;

  return (
    <AdaptiveRecordWorkspace preferenceKey="catalog-products" open={editorOpen} onClose={closeEditor} detail={editorDetail}>
    <div className="central-catalog-grid">
      <section className="work-stack central-catalog-list" aria-label="سجل المنتجات">
        <div className="action-row"><button type="button" className="button button-primary" disabled={busy || verticals.length === 0} onClick={() => startCreate()}>منتج جديد</button></div>
        <form className="catalog-registry-toolbar catalog-compact-toolbar" noValidate onSubmit={(event) => { event.preventDefault(); const nextQuery = query.trim(); changeFilters({ query: nextQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setAppliedQuery(nextQuery); }}>
          <label className="catalog-search-input">بحث<input aria-label="البحث في المنتجات" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اسم المنتج أو العلامة" /></label>
          <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
          <details className="catalog-mobile-filters" open={catalogFiltersOpen} onToggle={(event) => setCatalogFiltersOpen(event.currentTarget.open)}>
            <summary>تصفية وترتيب <span className="catalog-filter-count">{activeFilterCount ? `${activeFilterCount} مفعّلة` : ""}</span></summary>
            <div className="catalog-mobile-filter-fields">
              <label>المجال التجاري<select value={verticalFilter} onChange={(event) => { const verticalId = event.target.value; changeFilters({ query: appliedQuery, verticalId, categoryId: "", active: statusFilter, sort }); setVerticalFilter(verticalId); setCategoryFilter(""); }}><option value="">الكل</option>{sharedVerticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
              <label>بحث الفئات<input type="search" value={filterCategoryQuery} onChange={(event) => setFilterCategoryQuery(event.target.value)} placeholder="ابحث في جميع الفئات" aria-controls="catalog-filter-category" /></label>
              <label>الفئة<select id="catalog-filter-category" value={categoryFilter} onChange={(event) => { const categoryId = event.target.value; changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId, active: statusFilter, sort }); setCategoryFilter(categoryId); }}><option value="">كل الفئات</option>{filterCategories.map((category) => <option value={category.id} key={category.id}>{!verticalFilter ? `${sharedVerticals.find((vertical) => vertical.id === category.verticalId)?.nameAr ?? category.verticalId} / ` : ""}{category.pathAr}</option>)}</select></label>
              {filterCategoryLoading ? <span role="status" className="muted">جارٍ قراءة الفئات…</span> : filterCategoryNextCursor ? <button type="button" className="button button-quiet" onClick={() => void loadMoreFilterCategories()}>فئات إضافية</button> : null}
              <label>الحالة<select value={statusFilter} onChange={(event) => { const active = event.target.value; changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active, sort }); setStatusFilter(active); }}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">معطل</option></select></label>
              <label>الترتيب<select value={sort} onChange={(event) => { const sort = event.target.value; changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort }); setSort(sort); }}><option value="name_asc">الاسم أ–ي</option><option value="name_desc">الاسم ي–أ</option><option value="updated_desc">الأحدث تعديلًا</option><option value="updated_asc">الأقدم تعديلًا</option></select></label>
              {hasCatalogFilters ? <button type="button" className="button button-quiet catalog-clear-filters" onClick={() => { changeFilters({ query: "", verticalId: "", categoryId: "", active: "all", sort: "name_asc" }); setQuery(""); setAppliedQuery(""); setVerticalFilter(""); setCategoryFilter(""); setStatusFilter("all"); setSort("name_asc"); setMinVariants(""); setMinStores(""); setFilterCategoryQuery(""); setFilterCategories([]); setFilterCategoryNextCursor(""); }}>مسح كل المرشحات</button> : null}
            </div>
          </details>
        </form>
        <div className="catalog-registry-view-bar">
          <fieldset className="catalog-view-switch" aria-label="طريقة عرض المنتجات">
            <button type="button" className="button button-quiet" aria-pressed={viewMode === "table"} onClick={() => changeView("table")}>جدول المنتجات</button>
            <button type="button" className="button button-quiet" aria-pressed={viewMode === "gallery"} onClick={() => changeView("gallery")}>معرض الصور</button>
          </fieldset>
          {!loading && !registryError ? <div className="catalog-selection-bar" aria-live="polite">
            <strong>{registrySummary ? registrySummary.totalCount.toLocaleString("ar-YE") : "—"} منتج مطابق</strong>
            <span>{products.length.toLocaleString("ar-YE")} في الصفحة</span>

            {registrySummary ? <details className="catalog-result-source">
              <summary>مصدر البيانات</summary>
              <small>الكتالوج المركزي · آخر قراءة <time dateTime={registrySummary.measuredAt}>{new Date(registrySummary.measuredAt).toLocaleString("ar-YE", { timeZone: "UTC" })}</time> بالتوقيت العالمي</small>
            </details> : null}
          </div> : null}
        </div>
        {viewMode === "table" ? <div className="catalog-registry-table-wrap">
          <table className="catalog-registry-table">
            <thead><tr>
              <RegistryColumnHeader label="المنتج" active={Boolean(appliedQuery) || sort === "name_desc"}>
                <label>ترتيب الاسم<select value={sort.startsWith("name_") ? sort : "name_asc"} onChange={(event) => { const next = event.target.value; setSort(next); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort: next }); }}>
                  <option value="name_asc">أ–ي</option><option value="name_desc">ي–أ</option>
                </select></label>
              </RegistryColumnHeader>
              <RegistryColumnHeader label="المجال التجاري" active={Boolean(verticalFilter)}>
                <label>المجال<select value={verticalFilter} onChange={(event) => { const next = event.target.value; setVerticalFilter(next); setCategoryFilter(""); changeFilters({ query: appliedQuery, verticalId: next, categoryId: "", active: statusFilter, sort }); }}>
                  <option value="">جميع المجالات</option>{sharedVerticals.map((entry) => <option key={entry.id} value={entry.id}>{entry.nameAr}</option>)}
                </select></label>
              </RegistryColumnHeader>
              <RegistryColumnHeader label="فئات المنتج" active={Boolean(categoryFilter)}>
                <label>البحث عن فئة<input type="search" value={filterCategoryQuery} onChange={(event) => setFilterCategoryQuery(event.target.value)} placeholder="كل المجالات" /></label>
                <label>الفئة<select value={categoryFilter} onChange={(event) => { const next = event.target.value; setCategoryFilter(next); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: next, active: statusFilter, sort }); }}>
                  <option value="">جميع الفئات</option>{filterCategories.map((entry) => <option key={entry.id} value={entry.id}>{!verticalFilter ? `${sharedVerticals.find((vertical) => vertical.id === entry.verticalId)?.nameAr ?? entry.verticalId} / ` : ""}{entry.pathAr}</option>)}
                </select></label>
                {filterCategoryNextCursor ? <button type="button" disabled={filterCategoryLoading} onClick={() => void loadMoreFilterCategories()}>المزيد من الفئات</button> : null}
              </RegistryColumnHeader>
              <RegistryColumnHeader label="النسخ" active={Boolean(minVariants || sort.startsWith("variants"))}>
                <label>الحد الأدنى للنسخ<input type="number" min="0" step="1" value={minVariants} onChange={(event) => { setMinVariants(event.target.value); clearProductPageCursor(); }} /></label>
                <label>ترتيب النتائج<select value={sort.startsWith("variants") ? sort : "default"} onChange={(event) => { const next = event.target.value; const nextSort = next === "default" ? "name_asc" : next; setSort(nextSort); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort: nextSort }); }}>
                  <option value="default">ترتيب الاسم</option><option value="variants_asc">الأقل أولًا</option><option value="variants_desc">الأكثر أولًا</option>
                </select></label>
              </RegistryColumnHeader>
              <RegistryColumnHeader label="متاجر تعرضه" active={Boolean(minStores || sort.startsWith("stores"))}>
                <label>الحد الأدنى للمتاجر<input type="number" min="0" step="1" value={minStores} onChange={(event) => { setMinStores(event.target.value); clearProductPageCursor(); }} /></label>
                <label>ترتيب النتائج<select value={sort.startsWith("stores") ? sort : "default"} onChange={(event) => { const next = event.target.value; const nextSort = next === "default" ? "name_asc" : next; setSort(nextSort); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort: nextSort }); }}>
                  <option value="default">ترتيب الاسم</option><option value="stores_asc">الأقل أولًا</option><option value="stores_desc">الأكثر أولًا</option>
                </select></label>
              </RegistryColumnHeader>
              <RegistryColumnHeader label="الحالة" active={statusFilter !== "all"}>
                <label>حالة المنتج<select value={statusFilter} onChange={(event) => { const next = event.target.value; setStatusFilter(next); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: next, sort }); }}>
                  <option value="all">جميع الحالات</option><option value="active">نشط</option><option value="inactive">معطل</option>
                </select></label>
              </RegistryColumnHeader>
              <RegistryColumnHeader label="آخر تحديث" active={sort.startsWith("updated_")}>
                <label>ترتيب التحديث<select value={sort.startsWith("updated_") ? sort : "updated_desc"} onChange={(event) => { const next = event.target.value; setSort(next); changeFilters({ query: appliedQuery, verticalId: verticalFilter, categoryId: categoryFilter, active: statusFilter, sort: next }); }}>
                  <option value="updated_desc">الأحدث أولًا</option><option value="updated_asc">الأقدم أولًا</option>
                </select></label>
              </RegistryColumnHeader>
              <th scope="col">ملف المنتج</th>
            </tr></thead>
            <tbody>
              {loading && products.length === 0 ? <tr><td colSpan={8} className="catalog-table-state">جارٍ قراءة السجل…</td></tr> : null}
              {!loading && !registryError && products.length === 0 ? <tr><td colSpan={8} className="catalog-table-state">لا توجد منتجات مطابقة للفلاتر.</td></tr> : null}
              {products.map((product) => <tr key={product.id} className={selected?.id === product.id ? "is-open" : ""}>
                <td><div className="catalog-registry-product">{product.primaryImageUri ? <img className="catalog-registry-product-image" src={product.primaryImageUri} alt="" loading="lazy" /> : <span className="catalog-registry-product-placeholder" aria-hidden="true">{product.canonicalName.trim().slice(0, 1) || "•"}</span>}<span><button type="button" className="catalog-product-name-action" disabled={detailLoading} onClick={() => void selectProduct(product.id)} aria-label={"إدارة منتج " + product.canonicalName}>{product.canonicalName}</button>{product.brand ? <small>{product.brand}</small> : null}</span></div></td>
                <td>{sharedVerticals.find((vertical) => vertical.id === product.verticalId)?.nameAr ?? "غير محدد"}</td>
                <td><span className="catalog-row-categories" title={product.categoryNamesAr?.join("، ") || "لم تصنف الفئات بعد"}>{product.categoryNamesAr?.length ? product.categoryNamesAr.slice(0, 2).join("، ") : product.categoryIds.length ? "أسماء الفئات غير متاحة" : "غير مصنف"}{(product.categoryNamesAr?.length ?? 0) > 2 ? ` +${product.categoryNamesAr!.length - 2}` : ""}</span></td><td>{product.variantCount.toLocaleString("ar-YE")}</td><td>{product.storeCount.toLocaleString("ar-YE")}</td>
                <td className="indicator-column"><ActivityIndicator active={product.active} inactiveLabel="معطل" /></td>
                <td><time dateTime={product.updatedAt}>{new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(product.updatedAt))}</time></td>
                 <td><button type="button" className="button button-secondary catalog-row-action" data-adaptive-record-trigger={`catalog-product-${product.id}`} disabled={detailLoading} aria-expanded={detailProductId === product.id && editorOpen} aria-label={`فتح ملف المنتج ${product.canonicalName}`} onClick={() => void selectProduct(product.id)}>ملف المنتج</button></td>
              </tr>)}
            </tbody>
          </table>
          <ul className="catalog-registry-mobile" aria-label="منتجات الصفحة الحالية">
            {products.map((product) => <li key={product.id} className="catalog-registry-mobile-card">
              <div className="catalog-registry-mobile-main">
                <div className="catalog-registry-product">
                  {product.primaryImageUri ? <img className="catalog-registry-product-image" src={product.primaryImageUri} alt="" loading="lazy" /> : <span className="catalog-registry-product-placeholder" aria-hidden="true">{product.canonicalName.trim().slice(0, 1) || "•"}</span>}
                  <span><strong>{product.canonicalName}</strong>{product.brand ? <small>{product.brand}</small> : null}<small>{sharedVerticals.find((vertical) => vertical.id === product.verticalId)?.nameAr ?? "غير محدد"}</small></span>
                </div>
                <ActivityIndicator active={product.active} inactiveLabel="معطل" />
              </div>
              <div className="catalog-registry-mobile-meta">
                <span>{product.categoryNamesAr?.slice(0, 2).join("، ") || "غير مصنف"}</span>
                <span>{product.variantCount.toLocaleString("ar-YE")} نسخ · {product.storeCount.toLocaleString("ar-YE")} متاجر</span>
              </div>
              <button type="button" className="button button-secondary catalog-mobile-open" data-adaptive-record-trigger={`catalog-product-${product.id}`} disabled={detailLoading} aria-expanded={detailProductId === product.id && editorOpen} onClick={() => void selectProduct(product.id)} aria-label={`فتح ملف المنتج ${product.canonicalName}`}>ملف المنتج</button>
            </li>)}
            {loading && products.length === 0 ? <li role="status" className="collection-state">جارٍ قراءة المنتجات…</li> : null}
            {!loading && !registryError && products.length === 0 ? <li className="collection-state">لا توجد منتجات مطابقة.</li> : null}
          </ul>
        </div> : <div className="catalog-gallery-pane" aria-busy={loading}>
          {loading && products.length === 0 ? <p role="status">جارٍ قراءة السجل…</p> : null}
          {!loading && !registryError && products.length === 0 ? <p className="catalog-gallery-empty">لا توجد منتجات مطابقة للفلاتر.</p> : null}
          <ul className="catalog-product-gallery" aria-label="المنتجات في الصفحة الحالية">
          {products.map((product) => <li className="catalog-gallery-card" key={product.id}>
            <button type="button" className="catalog-gallery-open" disabled={detailLoading} onClick={() => void selectProduct(product.id)} aria-label={`تفاصيل وصور ${product.canonicalName}`}>
              <ProductGalleryImage uri={product.primaryImageUri} name={product.canonicalName} />
              <strong>{product.canonicalName}</strong>
              {product.brand ? <small>{product.brand}</small> : null}
              <span className="catalog-gallery-meta">{sharedVerticals.find((vertical) => vertical.id === product.verticalId)?.nameAr ?? "غير محدد"} · {product.variantCount} نسخ · {product.storeCount} متاجر</span>
              <span className={`catalog-state-pill ${product.active ? "is-active" : "is-inactive"}`}>{product.active ? "نشط" : "معطل"}</span>
            </button>
          </li>)}
          </ul>
        </div>}
        {!editorOpen && registryError ? <div className="managed-status managed-status-warning" role="alert"><p>{registryError}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة قراءة سجل المنتجات</button></div> : null}
        {!editorOpen && notice ? <p className="success-inline" role="status">{notice}</p> : null}
        {!editorOpen && error ? <p className="identity-error" role="alert">{error}</p> : null}
    <footer className="registry-footer"><ActivityLegend inactiveLabel="معطل" /><CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading || Boolean(busy)} label="صفحات المنتجات" /></footer>
      </section>
      {previewMedia ? <dialog ref={previewDialogRef} className="catalog-image-dialog" aria-modal="true" aria-label={previewAlt} onCancel={(event) => { event.preventDefault(); closePreview(); }} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="action-row">
          <button type="button" className="button button-secondary" onClick={closePreview}>إغلاق الصورة</button>
          <button type="button" className="button button-secondary" disabled={previewIndex === 0} onClick={() => setPreviewIndex((index) => index === null ? null : index - 1)}>الصورة السابقة</button>
          <button type="button" className="button button-secondary" disabled={previewIndex === orderedMedia.length - 1} onClick={() => setPreviewIndex((index) => index === null ? null : index + 1)}>الصورة التالية</button>
        </div>
        <p className="muted" aria-live="polite">{previewAlt} · {new Intl.NumberFormat("ar-YE").format((previewIndex ?? 0) + 1)} من {new Intl.NumberFormat("ar-YE").format(orderedMedia.length)}</p>
        {failedPreviewUri === previewMedia.uri ? <div><p role="alert">تعذر عرض الصورة بالحجم الكبير.</p><button type="button" className="button button-secondary" onClick={() => setFailedPreviewUri("")}>إعادة تحميل الصورة</button></div> : <img key={previewMedia.uri} src={previewMedia.uri} alt={previewAlt} onError={() => setFailedPreviewUri(previewMedia.uri)} />}
      </dialog> : null}
    </div>
    </AdaptiveRecordWorkspace>
  );
}
