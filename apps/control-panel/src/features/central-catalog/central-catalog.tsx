"use client";

import type { CentralProduct, SellUnit } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

type ProductForm = { canonicalName: string; brand: string; barcode: string; canonicalImageUrl: string; sellUnit: SellUnit; active: boolean };

const emptyForm: ProductForm = { canonicalName: "", brand: "", barcode: "", canonicalImageUrl: "", sellUnit: "piece", active: true };

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

function toForm(product: CentralProduct): ProductForm {
  return { canonicalName: product.canonicalName, brand: product.brand ?? "", barcode: product.barcode ?? "", canonicalImageUrl: product.canonicalImageUrl ?? "", sellUnit: product.sellUnit, active: product.active };
}

export function CentralCatalog() {
  const [products, setProducts] = useState<ReadonlyArray<CentralProduct>>([]);
  const [selected, setSelected] = useState<CentralProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const response = await fetch(`/api/catalog/products${suffix}`, { cache: "no-store" });
      const payload = await parseResponse<{ products: ReadonlyArray<CentralProduct> }>(response);
      setProducts(payload.products);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة المنتجات المركزية.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  function selectProduct(product: CentralProduct) {
    setSelected(product);
    setForm(toForm(product));
    setNotice("");
    setError("");
  }

  function startCreate() {
    setSelected(null);
    setForm(emptyForm);
    setNotice("");
    setError("");
  }

  async function saveProduct() {
    if (busy || form.canonicalName.trim().length < 1) return;
    setBusy(true);
    setError("");
    setNotice("");
    const body = { canonicalName: form.canonicalName.trim(), sellUnit: form.sellUnit, active: form.active, ...(form.brand.trim() ? { brand: form.brand.trim() } : {}), ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}), ...(form.canonicalImageUrl.trim() ? { canonicalImageUrl: form.canonicalImageUrl.trim() } : {}) };
    try {
      const response = selected
        ? await fetch(`/api/catalog/products/${encodeURIComponent(selected.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) }, body: JSON.stringify(body) })
        : await fetch("/api/catalog/products", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const payload = await parseResponse<{ product: CentralProduct }>(response);
      setSelected(payload.product);
      setForm(toForm(payload.product));
      setNotice(selected ? "تم تحديث المنتج المركزي." : "تم إنشاء المنتج المركزي.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر حفظ المنتج المركزي.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="central-catalog-grid">
      <section className="access-card central-catalog-list" aria-labelledby="central-catalog-list-title">
        <div className="access-card-heading"><span className="step-chip">DSH · CENTRAL PRODUCT</span><p className="eyebrow">مصدر الحقيقة المركزي</p><h2 id="central-catalog-list-title">المنتجات المركزية</h2><p className="muted">هذه السجلات يكتبها المشغل فقط، وتقرأها المتاجر لاختيار عروضها المحلية.</p></div>
        <div className="catalog-search"><input aria-label="البحث في المنتجات المركزية" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="ابحث باسم المنتج" /><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>بحث</button></div>
        <button type="button" className="button button-primary" disabled={busy} onClick={startCreate}>منتج مركزي جديد</button>
        {loading ? <p className="muted">جارٍ قراءة المنتجات…</p> : products.length === 0 ? <p className="muted">لا توجد منتجات مطابقة.</p> : <div className="central-product-list">{products.map((product) => <button type="button" className={`central-product-row${selected?.id === product.id ? " selected" : ""}`} key={product.id} onClick={() => selectProduct(product)}><span><strong>{product.canonicalName}</strong><small>{product.brand || "بدون علامة"} · {product.sellUnit === "kg" ? "كيلو" : "قطعة"} · v{product.version}</small></span><em className={product.active ? "active" : "inactive"}>{product.active ? "نشط" : "معطل"}</em></button>)}</div>}
      </section>
      <section className="access-card central-catalog-editor" aria-labelledby="central-catalog-editor-title">
        <div className="access-card-heading"><p className="eyebrow">إدارة Product</p><h2 id="central-catalog-editor-title">{selected ? "تعديل المنتج المركزي" : "إنشاء منتج مركزي"}</h2><p className="muted">الاسم والصورة والهوية المركزية لا يملكها Partner.</p></div>
        <div className="central-product-form">
          <label className="field-label" htmlFor="central-product-name">الاسم القانوني<input id="central-product-name" disabled={busy} value={form.canonicalName} onChange={(event) => setForm({ ...form, canonicalName: event.target.value })} /></label>
          <label className="field-label" htmlFor="central-product-brand">العلامة<input id="central-product-brand" disabled={busy} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label className="field-label" htmlFor="central-product-barcode">الباركود<input id="central-product-barcode" disabled={busy} inputMode="numeric" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="8 إلى 14 رقمًا" /></label>
          <label className="field-label" htmlFor="central-product-image">رابط الصورة المركزية<input id="central-product-image" disabled={busy} inputMode="url" value={form.canonicalImageUrl} onChange={(event) => setForm({ ...form, canonicalImageUrl: event.target.value })} placeholder="https://…" /></label>
          <label className="field-label" htmlFor="central-product-unit">وحدة البيع<select id="central-product-unit" disabled={busy || selected !== null} value={form.sellUnit} onChange={(event) => setForm({ ...form, sellUnit: event.target.value as SellUnit })}><option value="piece">قطعة</option><option value="kg">كيلو</option></select>{selected ? <small className="muted">جزء من هوية المنتج ولا تتغير بعد الإنشاء.</small> : null}</label>
          {selected ? <label className="central-active-toggle"><input type="checkbox" disabled={busy} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> المنتج نشط وقابل للاختيار</label> : null}
          <button type="button" className="button button-primary" disabled={busy || !form.canonicalName.trim()} onClick={() => void saveProduct()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إنشاء المنتج"}</button>
          {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={startCreate}>إلغاء التعديل</button> : null}
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}
        {error ? <p className="identity-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
