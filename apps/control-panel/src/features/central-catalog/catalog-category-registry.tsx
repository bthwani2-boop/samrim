"use client";

import type { CatalogCategory, CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";

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

export function CatalogCategoryRegistry() {
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadVerticals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/verticals", { cache: "no-store" });
      const nextVerticals = (await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response)).verticals;
      setVerticals(nextVerticals);
      setVerticalId((current) => current && nextVerticals.some((vertical) => vertical.id === current) ? current : nextVerticals[0]?.id ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة المجالات التجارية.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async (nextVerticalId: string) => {
    if (!nextVerticalId) { setCategories([]); return; }
    try {
      const response = await fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(nextVerticalId)}`, { cache: "no-store" });
      setCategories((await parseResponse<{ categories: ReadonlyArray<CatalogCategory> }>(response)).categories);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة التصنيفات.");
    }
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => { void loadCategories(verticalId); }, [verticalId, loadCategories]);

  async function create() {
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    if (!verticalId) { setError("اختر المجال التجاري أولًا."); return; }
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) { setError("يجب أن يتراوح اسم التصنيف العربي والإنجليزي بين حرفين و160 حرفًا."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/catalog/categories", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ verticalId, parentCategoryId: null, nameAr: normalizedNameAr, nameEn: normalizedNameEn, active }) });
      const payload = await parseResponse<{ category: CatalogCategory }>(response);
      setNotice(`تم حفظ التصنيف: ${payload.category.nameAr}.`);
      setNameAr("");
      setNameEn("");
      await loadCategories(verticalId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء التصنيف.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="access-card" aria-labelledby="catalog-category-registry-title">
      <div className="access-card-heading">
        <span className="step-chip">تصنيف المنتجات</span>
        <p className="eyebrow">التصنيفات التابعة للمجال</p>
        <h2 id="catalog-category-registry-title">إضافة تصنيف منتج</h2>
        <p className="muted">التصنيف يخص المنتج داخل المجال التجاري، ولا يضيف مجالًا ثانيًا للمتجر أو للشريك. اختر المجال ثم أنشئ تصنيفاته؛ DSH يولّد المعرف الداخلي تلقائيًا.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="catalog-category-vertical">المجال التجاري<select id="catalog-category-vertical" disabled={busy} value={verticalId} onChange={(event) => setVerticalId(event.target.value)}><option value="">{verticals.length ? "اختر المجال التجاري" : "لا توجد مجالات نشطة"}</option>{verticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-name-ar">الاسم العربي للتصنيف<input id="catalog-category-name-ar" disabled={busy} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="قهوة" /></label>
        <label className="field-label" htmlFor="catalog-category-name-en">الاسم الإنجليزي للتصنيف<input id="catalog-category-name-en" disabled={busy} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Coffee" /></label>
        <label className="field-label" htmlFor="catalog-category-active"><input id="catalog-category-active" type="checkbox" disabled={busy} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط عند الإنشاء</label>
        <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void loadVerticals()}>إعادة قراءة المجالات</button>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>{busy ? "جارٍ الحفظ…" : "إضافة تصنيف"}</button>
      </div>
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void loadVerticals()}>إعادة المحاولة</button></p> : null}
      <div className="managed-status managed-status-info">
        <strong>تصنيفات المجال المحدد</strong>
        {loading ? <p>جارٍ قراءة السجل…</p> : !verticalId ? <p>أضف مجالًا تجاريًا ثم أعد قراءة المجالات.</p> : categories.length === 0 ? <p>لا توجد تصنيفات لهذا المجال بعد.</p> : <ul>{categories.map((category) => <li key={category.id}><span>{category.nameAr} · {category.nameEn}</span></li>)}</ul>}
      </div>
    </section>
  );
}
