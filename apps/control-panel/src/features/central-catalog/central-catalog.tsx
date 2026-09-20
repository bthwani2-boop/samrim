"use client";

import type { BaseUnit, CatalogProduct, CatalogVariant, CommerceVertical, MeasurementKind } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

type ProductForm = { verticalId: string; scope: "SHARED" | "STORE_SCOPED"; canonicalName: string; brand: string; variantTitle: string; measurementKind: MeasurementKind; baseUnit: BaseUnit; categoryId: string; identifierType: string; identifierValue: string; imageUri: string; galleryImageUris: string; active: boolean };

const emptyForm: ProductForm = { verticalId: "", scope: "SHARED", canonicalName: "", brand: "", variantTitle: "", measurementKind: "DISCRETE", baseUnit: "COUNT", categoryId: "", identifierType: "GTIN", identifierValue: "", imageUri: "", galleryImageUris: "", active: true };

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
  return { verticalId: product.verticalId ?? "", scope: product.scope as ProductForm["scope"], canonicalName: product.canonicalName, brand: product.brand ?? "", variantTitle: variant?.title ?? "", measurementKind: variant?.measurementKind ?? "DISCRETE", baseUnit: variant?.baseUnit ?? "COUNT", categoryId: product.categoryIds[0] ?? "", identifierType: identifier?.type ?? "GTIN", identifierValue: identifier?.value ?? "", imageUri: orderedMedia.find((item) => item.role === "primary")?.uri ?? "", galleryImageUris: orderedMedia.filter((item) => item.role === "gallery").map((item) => item.uri).join("\n"), active: product.active };
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
  const [products, setProducts] = useState<ReadonlyArray<CatalogProduct>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>>([]);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    setLoading(true);
    setError("");
    try {
      const suffix = new URLSearchParams({ limit: "50" });
      if (query.trim()) suffix.set("q", query.trim());
      if (verticalFilter) suffix.set("verticalId", verticalFilter);
      if (cursor) suffix.set("cursor", cursor);
      const response = await fetch(`/api/catalog/products?${suffix.toString()}`, { cache: "no-store" });
      const payload = await parseResponse<{ products: ReadonlyArray<CatalogProduct>; nextCursor?: string }>(response);
      setProducts((current) => append ? [...current, ...payload.products] : payload.products);
      setNextCursor(payload.nextCursor ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة الكتالوج.");
    } finally {
      setLoading(false);
    }
  }, [query, verticalFilter]);

  useEffect(() => { void loadVerticals().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة المجالات.")); }, [loadVerticals]);
  useEffect(() => { void loadCategories(form.verticalId).catch((nextError) => setError(nextError instanceof Error ? nextError.message : "تعذر قراءة التصنيفات.")); }, [form.verticalId, loadCategories]);
  useEffect(() => { void load(); }, [load]);

  function selectProduct(product: CatalogProduct) { setSelected(product); setForm(toForm(product)); setNotice(""); setError(""); }
  function startCreate() { setSelected(null); setForm({ ...emptyForm, verticalId: verticals[0]?.id ?? "" }); setNotice(""); setError(""); }

  async function saveProduct() {
    if (busy || form.scope !== "SHARED" || !form.canonicalName.trim() || !form.verticalId || !form.categoryId) return;
    setBusy(true); setError(""); setNotice("");
    const body = { canonicalName: form.canonicalName.trim(), verticalId: form.verticalId, scope: "SHARED" as const, measurementKind: form.measurementKind, baseUnit: form.baseUnit, categoryIds: [form.categoryId], ...(form.variantTitle.trim() ? { variantTitle: form.variantTitle.trim() } : {}), ...(form.brand.trim() ? { brand: form.brand.trim() } : {}), ...(form.identifierValue.trim() ? { identifierType: form.identifierType, identifierValue: form.identifierValue.trim() } : {}), ...(form.imageUri.trim() ? { imageUri: form.imageUri.trim() } : {}), active: form.active };
    try {
      const response = selected
        ? await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body: JSON.stringify({ canonicalName: body.canonicalName, verticalId: body.verticalId, scope: body.scope, active: body.active, ...(body.brand ? { brand: body.brand } : {}) }) })
        : await fetch("/api/catalog/products", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const payload = await parseResponse<{ product: CatalogProduct }>(response);
      setSelected(payload.product); setForm(toForm(payload.product)); setNotice(selected ? "تم تحديث المنتج." : "تم إنشاء المنتج والنسخة الافتراضية."); await load();
    } catch (nextError) {
      if (nextError && typeof nextError === "object" && (nextError as { status?: number }).status === 409) {
        setError("تغير المنتج قبل حفظك. أُعيدت قراءة السجل الحالي؛ راجع النسخة ثم أعد المحاولة.");
        await load();
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
      } else {
        setError(nextError instanceof Error ? nextError.message : "تعذر حفظ صور المنتج.");
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="central-catalog-grid">
      <section className="access-card central-catalog-list" aria-labelledby="central-catalog-list-title">
        <div className="access-card-heading"><span className="step-chip">إدارة المنتجات</span><p className="eyebrow">سجل المنتجات</p><h2 id="central-catalog-list-title">المنتجات والنسخ</h2><p className="muted">المنتج يملك الهوية؛ وكل متجر يملك عرضه التجاري المنفصل.</p></div>
        <div className="catalog-search"><input aria-label="البحث في الكتالوج" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="ابحث باسم المنتج" /><select aria-label="تصفية حسب المجال" value={verticalFilter} onChange={(event) => setVerticalFilter(event.target.value)}><option value="">كل المجالات</option>{verticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>بحث</button></div>
        <button type="button" className="button button-primary" disabled={busy || verticals.length === 0} onClick={startCreate}>منتج جديد</button>
        {loading ? <p className="muted">جارٍ قراءة الكتالوج…</p> : products.length === 0 ? <p className="muted">لا توجد منتجات مطابقة.</p> : <><div className="central-product-list">{products.map((product) => <button type="button" className={`central-product-row${selected?.id === product.id ? " selected" : ""}`} key={product.id} onClick={() => selectProduct(product)}><span><strong>{product.canonicalName}</strong><small>{product.scope === "SHARED" ? "مشترك" : "خاص بالمتجر"} · {product.variants.length} نسخ</small></span><em className={product.active ? "active" : "inactive"}>{product.active ? "نشط" : "معطل"}</em></button>)}</div>{nextCursor ? <button type="button" className="button button-secondary" disabled={loading} onClick={() => void load(nextCursor, true)}>تحميل المزيد</button> : null}</>}
      </section>
      <section className="access-card central-catalog-editor" aria-labelledby="central-catalog-editor-title">
        <div className="access-card-heading"><p className="eyebrow">تحرير المنتج والنسخة</p><h2 id="central-catalog-editor-title">{selected ? "تعديل المنتج" : "إنشاء منتج"}</h2><p className="muted">تُحفظ الهوية والتصنيف والنسخة الافتراضية في سجل المنتجات.</p></div>
        <div className="central-product-form">
          <label className="field-label" htmlFor="catalog-vertical">المجال التجاري<select id="catalog-vertical" disabled={busy || selected !== null} value={form.verticalId} onChange={(event) => setForm({ ...form, verticalId: event.target.value, categoryId: "" })}><option value="">اختر مجالًا</option>{verticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
          <label className="field-label" htmlFor="catalog-category">التصنيف<select id="catalog-category" disabled={busy || selected !== null || !form.verticalId} value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">اختر تصنيفًا</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.nameAr}</option>)}</select></label>
          {form.scope === "STORE_SCOPED" ? <p className="muted">هذا المنتج خاص بمتجر ويُدار من مساحة المتجر.</p> : null}
          <label className="field-label" htmlFor="catalog-product-name">الاسم القانوني<input id="catalog-product-name" disabled={busy} value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-product-brand">العلامة<input id="catalog-product-brand" disabled={busy} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label className="field-label" htmlFor="catalog-variant-title">عنوان النسخة<input id="catalog-variant-title" disabled={busy || selected !== null} value={form.variantTitle} onChange={(event) => setForm({ ...form, variantTitle: event.target.value })} placeholder="الافتراضي" /></label>
          <label className="field-label" htmlFor="catalog-measurement-kind">سياسة القياس<select id="catalog-measurement-kind" disabled={busy || selected !== null} value={form.measurementKind} onChange={(event) => { const measurementKind = event.target.value as MeasurementKind; setForm({ ...form, measurementKind, baseUnit: measurementKind === "DISCRETE" ? "COUNT" : form.baseUnit === "COUNT" ? "GRAM" : form.baseUnit }); }}><option value="DISCRETE">عددي</option><option value="MEASURED">مقاس ثابت</option><option value="VARIABLE_MEASURE">مقاس متغير</option></select></label>
          <label className="field-label" htmlFor="catalog-base-unit">الوحدة الأساسية<select id="catalog-base-unit" disabled={busy || selected !== null} value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value as BaseUnit })}><option value="COUNT">قطعة</option><option value="GRAM">غرام</option><option value="MILLILITER">مل</option></select></label>
          <label className="field-label" htmlFor="catalog-identifier">نوع المعرّف<input id="catalog-identifier" disabled={busy || selected !== null} value={form.identifierType} onChange={(event) => setForm({ ...form, identifierType: event.target.value.toUpperCase() })} /></label>
          <label className="field-label" htmlFor="catalog-identifier-value">قيمة المعرّف<input id="catalog-identifier-value" disabled={busy || selected !== null} value={form.identifierValue} onChange={(event) => setForm({ ...form, identifierValue: event.target.value })} /></label>
          {selected ? <><label className="field-label" htmlFor="catalog-image">رابط الصورة الأساسية<input id="catalog-image" disabled={busy} inputMode="url" value={form.imageUri} onChange={(event) => setForm({ ...form, imageUri: event.target.value })} placeholder="https://…" /></label><label className="field-label" htmlFor="catalog-gallery">صور المعرض<textarea id="catalog-gallery" disabled={busy} rows={4} value={form.galleryImageUris} onChange={(event) => setForm({ ...form, galleryImageUris: event.target.value })} placeholder="رابط صورة في كل سطر" /></label><p className="muted">الصورة الأساسية إلزامية عند وجود صور، وكل رابط معرض يظهر بعده حسب الترتيب.</p></> : <label className="field-label" htmlFor="catalog-image">رابط الصورة الأساسية<input id="catalog-image" disabled={busy} inputMode="url" value={form.imageUri} onChange={(event) => setForm({ ...form, imageUri: event.target.value })} placeholder="https://…" /></label>}
          {selected ? <label className="central-active-toggle"><input type="checkbox" disabled={busy} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> المنتج نشط وقابل للاختيار</label> : null}
          <button type="button" className="button button-primary" disabled={busy || form.scope !== "SHARED" || !form.canonicalName.trim() || !form.verticalId || !form.categoryId} onClick={() => void saveProduct()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إنشاء المنتج"}</button>
          {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void saveMedia()}>حفظ الصور</button> : null}
          {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={startCreate}>إلغاء التعديل</button> : null}
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
