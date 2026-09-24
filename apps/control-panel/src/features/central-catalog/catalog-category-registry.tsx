"use client";

import type { CatalogCategory, CommerceVertical } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";

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

export function CatalogCategoryRegistry() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [selected, setSelected] = useState<CatalogCategory | null>(null);
  const [verticalId, setVerticalId] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadVerticals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" });
      const nextVerticals = (await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response)).verticals;
      setVerticals(nextVerticals);
      setVerticalId((current) => current && nextVerticals.some((vertical) => vertical.id === current) ? current : "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة المجالات التجارية.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async (nextVerticalId: string) => {
    if (!nextVerticalId) { setCategories([]); return; }
    try {
      const response = await fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(nextVerticalId)}&includeInactive=true`, { cache: "no-store" });
      setCategories((await parseResponse<{ categories: ReadonlyArray<CatalogCategory> }>(response)).categories);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر قراءة التصنيفات.");
    }
  }, []);

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => { void loadCategories(verticalId); }, [verticalId, loadCategories]);

  async function create() {
    if (!canEdit) return;
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    const normalizedReason = reason.trim();
    if (!verticalId) { setError("اختر المجال التجاري أولًا."); return; }
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) { setError("يجب أن يتراوح اسم التصنيف العربي والإنجليزي بين حرفين و160 حرفًا."); return; }
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق الإضافة."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected ? `/api/catalog/categories/${encodeURIComponent(selected.id)}` : "/api/catalog/categories", { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...(selected ? { parentCategoryId, expectedVersion: selected.version } : { verticalId, parentCategoryId }), nameAr: normalizedNameAr, nameEn: normalizedNameEn, active, reason: normalizedReason }) });
      const payload = await parseResponse<{ category: CatalogCategory }>(response);
      setNotice(selected ? `تم تحديث التصنيف: ${payload.category.nameAr}.` : `تم حفظ التصنيف: ${payload.category.nameAr}.`);
      setSelected(null);
      setNameAr("");
      setNameEn("");
      setParentCategoryId("");
      setReason("");
      await loadCategories(verticalId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء التصنيف.");
    } finally {
      setBusy(false);
    }
  }

  function edit(category: CatalogCategory) {
    setSelected(category);
    setVerticalId(category.verticalId);
    setParentCategoryId(category.parentCategoryId ?? "");
    setNameAr(category.nameAr);
    setNameEn(category.nameEn);
    setActive(category.active);
    setReason("");
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setSelected(null);
    setParentCategoryId("");
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
  }

  const categoryIndex = new Map(categories.map((category) => [category.id, category]));
  const orderedCategories = [...categories].sort((left, right) => categoryDepth(left, categoryIndex) - categoryDepth(right, categoryIndex) || left.nameAr.localeCompare(right.nameAr, "ar"));

  return (
    <section className="access-card" aria-labelledby="catalog-category-registry-title">
      <div className="access-card-heading">
        <span className="step-chip">تصنيف المنتجات</span>
        <p className="eyebrow">التصنيفات التابعة للمجال</p>
        <h2 id="catalog-category-registry-title">{selected ? "تعديل تصنيف منتج" : "إضافة تصنيف منتج"}</h2>
        <p className="muted">التصنيف يخص المنتج داخل المجال التجاري، ولا يضيف مجالًا ثانيًا للمتجر أو للشريك. اختر المجال ثم أنشئ تصنيفاته؛ DSH يولّد المعرف الداخلي تلقائيًا.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="catalog-category-vertical">المجال التجاري<select id="catalog-category-vertical" disabled={busy || Boolean(selected)} value={verticalId} onChange={(event) => { setVerticalId(event.target.value); setParentCategoryId(""); }}><option value="">{verticals.length ? "اختر المجال التجاري" : "لا توجد مجالات"}</option>{verticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · متوقف"}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-parent">التصنيف الأب<select id="catalog-category-parent" disabled={busy || !canEdit || !verticalId} value={parentCategoryId} onChange={(event) => setParentCategoryId(event.target.value)}><option value="">تصنيف رئيسي</option>{orderedCategories.filter((category) => !selected || (category.id !== selected.id && !isDescendant(category.id, selected.id, categoryIndex))).map((category) => <option value={category.id} key={category.id}>{"　".repeat(categoryDepth(category, categoryIndex))}{category.nameAr}{category.active ? "" : " · متوقف"}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-name-ar">الاسم العربي للتصنيف<input id="catalog-category-name-ar" disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="قهوة" /></label>
        <label className="field-label" htmlFor="catalog-category-name-en">الاسم الإنجليزي للتصنيف<input id="catalog-category-name-en" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Coffee" /></label>
        <label className="field-label" htmlFor="catalog-category-active"><input id="catalog-category-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط</label>
        <label className="field-label" htmlFor="catalog-category-reason">سبب التغيير<textarea id="catalog-category-reason" disabled={busy || !canEdit} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void loadVerticals()}>إعادة قراءة المجالات</button>
        <button type="button" className="button button-primary" disabled={busy || !canEdit || !verticalId || reason.trim().length < 5} onClick={() => void create()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إضافة تصنيف"}</button>
        {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={cancelEdit}>إلغاء التعديل</button> : null}
      </div>
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void loadVerticals()}>إعادة المحاولة</button></p> : null}
      <div className="managed-status managed-status-info">
        <strong>شجرة تصنيفات المجال المحدد</strong>
        {loading ? <p>جارٍ قراءة السجل…</p> : !verticalId ? <p>اختر مجالًا تجاريًا لقراءة شجرته.</p> : categories.length === 0 ? <p>لا توجد تصنيفات لهذا المجال بعد.</p> : <ul>{orderedCategories.map((category) => <li key={category.id} style={{ marginInlineStart: `${categoryDepth(category, categoryIndex) * 1.25}rem` }}><span>{category.nameAr} · {category.nameEn} · {category.active ? "نشط" : "متوقف"} · v{category.version}</span><button type="button" className="button button-secondary" disabled={busy || !canEdit} onClick={() => edit(category)}>تعديل</button></li>)}</ul>}
      </div>
    </section>
  );
}
