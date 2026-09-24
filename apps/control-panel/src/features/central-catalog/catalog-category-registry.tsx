"use client";

import type { CatalogCategory, CommerceVertical } from "@bthwani/dsh";
import { useState } from "react";
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

export function CatalogCategoryRegistry({ verticals, verticalId, onVerticalChange, categories, categoryId, onCategoryChange, loading, onSaved }: {
  verticals: ReadonlyArray<CommerceVertical>;
  verticalId: string;
  onVerticalChange: (verticalId: string) => void;
  categories: ReadonlyArray<CatalogCategory>;
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  loading: boolean;
  onSaved: () => Promise<void>;
}) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [selected, setSelected] = useState<CatalogCategory | null>(null);
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function create() {
    if (!canEdit) return;
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    const normalizedReason = reason.trim();
    if (!verticalId) { setError("اختر الفئة الرئيسية أولًا."); return; }
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) { setError("يجب أن يتراوح اسم الفئة العربي والإنجليزي بين حرفين و160 حرفًا."); return; }
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق الإضافة."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected ? `/api/catalog/categories/${encodeURIComponent(selected.id)}` : "/api/catalog/categories", { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...(selected ? { parentCategoryId, expectedVersion: selected.version } : { verticalId, parentCategoryId: parentCategoryId || null }), nameAr: normalizedNameAr, nameEn: normalizedNameEn, active, reason: normalizedReason }) });
      const payload = await parseResponse<{ category: CatalogCategory }>(response);
      setNotice(selected ? `تم تحديث الفئة: ${payload.category.nameAr}.` : `تم حفظ الفئة: ${payload.category.nameAr}.`);
      setSelected(null);
      setNameAr("");
      setNameEn("");
      setParentCategoryId("");
      setReason("");
      onCategoryChange(payload.category.id);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء الفئة.");
    } finally {
      setBusy(false);
    }
  }

  function edit(category: CatalogCategory) {
    setSelected(category);
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
    <div className="catalog-taxonomy-section" aria-labelledby="catalog-category-registry-title">
      <div className="access-card-heading">
        <span className="step-chip">فئات المنتجات</span>
        <p className="eyebrow">شجرة الفئات</p>
        <h3 id="catalog-category-registry-title">{selected ? "تعديل فئة" : "إضافة فئة"}</h3>
        <p className="muted">اختر فئة عليا لتنظيم شجرتها. يتيح حقل الفئة الأب إنشاء مستويات متداخلة، ويولّد DSH المعرف الداخلي تلقائيًا.</p>
      </div>
      <div className="access-form">
        <label className="field-label" htmlFor="catalog-category-vertical">الفئة العليا<select id="catalog-category-vertical" disabled={busy || Boolean(selected)} value={verticalId} onChange={(event) => { onVerticalChange(event.target.value); onCategoryChange(""); setParentCategoryId(""); }}><option value="">{verticals.length ? "اختر فئة عليا" : "لا توجد فئات عليا"}</option>{verticals.map((vertical) => <option value={vertical.id} key={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · متوقف"}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-parent">الفئة الأب<select id="catalog-category-parent" disabled={busy || !canEdit || !verticalId} value={parentCategoryId} onChange={(event) => setParentCategoryId(event.target.value)}><option value="">فئة رئيسية</option>{orderedCategories.filter((category) => !selected || (category.id !== selected.id && !isDescendant(category.id, selected.id, categoryIndex))).map((category) => <option value={category.id} key={category.id}>{"　".repeat(categoryDepth(category, categoryIndex))}{category.nameAr}{category.active ? "" : " · متوقف"}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-selected">الفئة المحددة لخصائصها<select id="catalog-category-selected" disabled={busy || loading || !verticalId} value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}><option value="">اختر فئة</option>{orderedCategories.map((category) => <option value={category.id} key={category.id}>{"　".repeat(categoryDepth(category, categoryIndex))}{category.nameAr}{category.active ? "" : " · متوقف"}</option>)}</select></label>
        <label className="field-label" htmlFor="catalog-category-name-ar">اسم الفئة بالعربية<input id="catalog-category-name-ar" disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="قهوة" /></label>
        <label className="field-label" htmlFor="catalog-category-name-en">اسم الفئة بالإنجليزية<input id="catalog-category-name-en" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Coffee" /></label>
        <label className="field-label" htmlFor="catalog-category-active"><input id="catalog-category-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط</label>
        <label className="field-label" htmlFor="catalog-category-reason">سبب التغيير<textarea id="catalog-category-reason" disabled={busy || !canEdit} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" className="button button-primary" disabled={busy || !canEdit || !verticalId || reason.trim().length < 5} onClick={() => void create()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إضافة فئة"}</button>
        {selected ? <button type="button" className="button button-secondary" disabled={busy} onClick={cancelEdit}>إلغاء التعديل</button> : null}
      </div>
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void onSaved()}>إعادة المحاولة</button></p> : null}
      <div className="catalog-taxonomy-inline">
        <strong>شجرة الفئات في الفئة الرئيسية المحددة</strong>
        {loading ? <p>جارٍ قراءة السجل…</p> : !verticalId ? <p>اختر فئة رئيسية لقراءة شجرتها.</p> : categories.length === 0 ? <p>لا توجد فئات لهذه الفئة الرئيسية بعد.</p> : <ul>{orderedCategories.map((category) => <li key={category.id} style={{ marginInlineStart: `${categoryDepth(category, categoryIndex) * 1.25}rem` }}><span>{category.nameAr} · {category.nameEn} · {category.active ? "نشط" : "متوقف"} · v{category.version}</span><button type="button" className="button button-secondary" disabled={busy || !canEdit} onClick={() => edit(category)}>تعديل</button></li>)}</ul>}
      </div>
    </div>
  );
}
