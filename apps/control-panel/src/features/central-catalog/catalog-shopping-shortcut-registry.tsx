"use client";

import type { CatalogCategoryListItem, CommercialStoreType, ShoppingShortcut, ShoppingShortcutListResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { RegistryColumnHeader } from "../shared/registry-column-header";

type Option = Readonly<{ id: string; nameAr: string; active: boolean; pathAr: string }>;
type RegistryRead = Readonly<{ categories: ReadonlyArray<CatalogCategoryListItem>; nextCursor?: string }>;

function errorMessage(input: unknown) {
  if (input && typeof input === "object" && "error" in input) {
    const error = (input as { error?: { message?: string } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return "تعذر حفظ اختصار التسوق. أعد القراءة وحاول مجددًا.";
}

async function readOptions(verticalId: string) {
  const typesResponse = await fetch(`/api/catalog/commercial-store-types?${new URLSearchParams({ verticalId, includeInactive: "true" })}`, { cache: "no-store" });
  const typesBody = await typesResponse.json() as { storeTypes?: ReadonlyArray<CommercialStoreType>; error?: unknown };
  if (!typesResponse.ok || !typesBody.storeTypes) throw new Error(errorMessage(typesBody));
  const categories: Option[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ verticalId, status: "all", sort: "name_asc", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/catalog/categories?${query}`, { cache: "no-store" });
    const body = await response.json() as RegistryRead | { error?: unknown };
    if (!response.ok || !("categories" in body)) throw new Error(errorMessage(body));
    categories.push(...body.categories.map((item) => ({ id: item.id, nameAr: item.nameAr, active: item.active, pathAr: item.pathAr })));
    cursor = body.nextCursor ?? "";
    if (!cursor) return { types: typesBody.storeTypes, categories };
  }
  throw new Error("نتائج الفئات كثيرة ولم يكتمل تحميلها. استخدم البحث في إدارة الفئات أولًا.");
}

export function CatalogShoppingShortcutRegistry({ verticalId, editorOnly = false, initialId, onSaved, onClose }: Readonly<{ verticalId: string; editorOnly?: boolean; initialId?: string | undefined; onSaved?: () => Promise<void>; onClose?: () => void }>) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [items, setItems] = useState<ReadonlyArray<ShoppingShortcut>>([]);
  const [types, setTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<Option>>([]);
  const [selected, setSelected] = useState<ShoppingShortcut | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleAr, setTitleAr] = useState("");
  const [ordinal, setOrdinal] = useState(0);
  const [active, setActive] = useState(true);
  const [typeIds, setTypeIds] = useState<ReadonlyArray<string>>([]);
  const [categoryIds, setCategoryIds] = useState<ReadonlyArray<string>>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listQuery,setListQuery]=useState("");
  const [listStatus,setListStatus]=useState("all");
  const visibleShortcuts=items.filter(item=>(!listQuery.trim()||item.titleAr.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase()))
    && (listStatus==="all" || item.active === (listStatus==="active")));
  const reloadSequence = useRef(0);
  const initialized = useRef(false);

  const clearEditor = useCallback(() => {
    setSelected(null);
    setTitleAr("");
    setOrdinal(0);
    setActive(true);
    setTypeIds([]);
    setCategoryIds([]);
    setReason("");
    setEditing(false);
  }, []);

  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    if (!verticalId) { setItems([]); return; }
    setLoading(true);
    setError("");
    try {
      const [response, options] = await Promise.all([
        fetch(`/api/catalog/shopping-shortcuts?${new URLSearchParams({ verticalId })}`, { cache: "no-store" }),
        readOptions(verticalId),
      ]);
      const body = await response.json() as ShoppingShortcutListResponse | { error?: unknown };
      if (!response.ok || !("shortcuts" in body)) throw new Error(errorMessage(body));
      if (sequence !== reloadSequence.current) return;
      setItems(body.shortcuts);
      setTypes(options.types);
      setCategories(options.categories);
    } catch (cause) {
      if (sequence === reloadSequence.current) setError(cause instanceof Error ? cause.message : "تعذر قراءة اختصارات التسوق.");
    } finally { if (sequence === reloadSequence.current) setLoading(false); }
  }, [verticalId]);

  useEffect(() => { clearEditor(); setNotice(""); void reload(); }, [clearEditor, reload]);

  const edit = useCallback((item: ShoppingShortcut) => {
    setSelected(item);
    setTitleAr(item.titleAr);
    setOrdinal(item.ordinal);
    setActive(item.active);
    setTypeIds(item.storeTypeIds);
    setCategoryIds(item.categoryIds);
    setReason("");
    setNotice("");
    setError("");
    setEditing(true);
  }, []);

  useEffect(() => {
    if (!editorOnly || initialized.current) return;
    if (initialId) {
      const item = items.find((entry) => entry.id === initialId);
      if (!item) return;
      initialized.current = true;
      edit(item);
    } else {
      initialized.current = true;
      clearEditor();
      setEditing(true);
    }
  }, [editorOnly, initialId, items, clearEditor, edit]);

  function toggle(id: string, current: ReadonlyArray<string>, set: (next: ReadonlyArray<string>) => void) {
    set(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save() {
    if (!canEdit || !verticalId || saving) return;
    if (titleAr.trim().length < 2 || typeIds.length + categoryIds.length === 0 ||
        typeIds.length + categoryIds.length > 25 || reason.trim().length < 5 || ordinal < 0 || ordinal > 9999) {
      setError("أدخل اسمًا وترتيبًا ومصدرًا واحدًا على الأقل وسببًا للتغيير من 5 أحرف.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected
        ? `/api/catalog/shopping-shortcuts/${encodeURIComponent(selected.id)}`
        : "/api/catalog/shopping-shortcuts", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          verticalId, titleAr: titleAr.trim(), ordinal, active,
          expectedVersion: selected?.version ?? 0,
          storeTypeIds: [...typeIds], categoryIds: [...categoryIds], reason: reason.trim(),
        }),
      });
      const payload = await response.json() as { shortcut?: ShoppingShortcut; error?: unknown };
      if (!response.ok || !payload.shortcut) throw new Error(errorMessage(payload));
      setNotice(`تم حفظ الاختصار «${payload.shortcut.titleAr}».`);
      clearEditor();
      await reload();
      if (editorOnly) { await onSaved?.(); onClose?.(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ اختصار التسوق."); }
    finally { setSaving(false); }
  }

  return <section className="catalog-taxonomy-section" aria-labelledby="shopping-shortcut-heading">
    {!editorOnly ? <div className="access-card-heading">
      <h3 id="shopping-shortcut-heading">اختصارات التسوق للعملاء</h3>
      <p className="muted">أسماء مبسطة تجمع أنواع متاجر أو فئات منتجات. لا تغيّر عمولات المتاجر أو تصنيفاتها الداخلية. تظهر للعملاء فقط عند وجود عروض مؤهلة.</p>
      {!editing ? <button type="button" className="button button-primary" disabled={!canEdit || !verticalId || loading || saving} onClick={() => { clearEditor(); setEditing(true); }}>إضافة اختصار</button> : null}
    </div> : null}
    {error ? <p role="alert" className="identity-error">{error} <button type="button" onClick={() => void reload()}>إعادة القراءة</button></p> : null}
    {notice ? <output className="managed-status managed-status-success">{notice}</output> : null}
    {loading ? <output>جارٍ قراءة اختصارات التسوق ومصادرها…</output> : null}
    {!loading && items.length === 0 && !error ? <p className="muted">لا توجد اختصارات لهذا المجال. لا تظهر اختصارات فارغة للعملاء.</p> : null}
    {editing || (editorOnly && !initialId) ? <fieldset className="access-form catalog-shortcut-editor" aria-label="محرر اختصار التسوق">
      <label className="field-label">اسم الاختصار الظاهر للعميل
        <input disabled={saving || !canEdit} value={titleAr} maxLength={160} onChange={(event) => setTitleAr(event.target.value)} placeholder="لحوم ودجاج" />
      </label>
      <label className="field-label">ترتيب الظهور
        <input type="number" min={0} max={9999} disabled={saving || !canEdit} value={ordinal} onChange={(event) => setOrdinal(Number(event.target.value))} />
      </label>
      <label className="field-label catalog-shortcut-active"><input type="checkbox" checked={active} disabled={saving || !canEdit} onChange={(event) => setActive(event.target.checked)} /> تفعيل الاختصار</label>
      <details open><summary>أنواع المتاجر المناسبة ({typeIds.length} محدد)</summary>
        <div>{types.filter((item) => item.active || typeIds.includes(item.id)).map((item) => <label className="field-label" key={item.id}>
          <input type="checkbox" checked={typeIds.includes(item.id)} disabled={!canEdit || saving || (!item.active && !typeIds.includes(item.id))} onChange={() => toggle(item.id, typeIds, setTypeIds)} /> {item.nameAr}{!item.active ? " (غير نشط)" : ""}
        </label>)}</div>
      </details>
      <details><summary>فئات المنتجات المناسبة ({categoryIds.length} محددة)</summary>
        <div>{categories.filter((item) => item.active || categoryIds.includes(item.id)).map((item) => <label className="field-label" key={item.id}>
          <input type="checkbox" checked={categoryIds.includes(item.id)} disabled={!canEdit || saving || (!item.active && !categoryIds.includes(item.id))} onChange={() => toggle(item.id, categoryIds, setCategoryIds)} /> {item.pathAr || item.nameAr}{!item.active ? " (غير نشطة)" : ""}
        </label>)}</div>
      </details>
      <label className="field-label">سبب الإضافة أو التعديل
        <textarea rows={2} value={reason} maxLength={500} disabled={!canEdit || saving} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="catalog-registry-actions unified-taxonomy-save-actions">
        <button type="button" className="button button-primary" disabled={!canEdit || saving} onClick={() => void save()}>{saving ? "جارٍ الحفظ…" : "حفظ الاختصار"}</button>
        <button type="button" className="button button-secondary" disabled={saving} onClick={() => { clearEditor(); if (editorOnly) onClose?.(); }}>إلغاء</button>
      </div>
    </fieldset> : null}
    {!editorOnly && items.length ? <div className="catalog-registry-table-wrap"><table className="catalog-registry-table">
      <thead><tr>
        <RegistryColumnHeader label="الاختصار" active={Boolean(listQuery)}>
          <label>اسم الاختصار<input type="search" value={listQuery} onChange={e=>setListQuery(e.target.value)} /></label>
        </RegistryColumnHeader>
        <th scope="col">المصادر</th>
        <RegistryColumnHeader label="الحالة" active={listStatus!=="all"}>
          <label>الحالة<select value={listStatus} onChange={e=>setListStatus(e.target.value)}>
            <option value="all">الجميع</option><option value="active">نشط</option><option value="inactive">معطل</option>
          </select></label>
        </RegistryColumnHeader>
        <th scope="col">الإدارة</th>
      </tr></thead>
      <tbody>{visibleShortcuts.map((item) => <tr key={item.id}>
        <td><strong>{item.titleAr}</strong></td>
        <td>{item.storeTypeIds.length} نوع متجر، {item.categoryIds.length} فئة</td>
        <td>{item.active ? "نشط" : "معطل"}</td>
        <td><button type="button" className="catalog-row-action" disabled={saving || !canEdit} onClick={() => edit(item)}>تعديل</button></td>
      </tr>)}{visibleShortcuts.length===0?<tr><td colSpan={4}>لا توجد اختصارات مطابقة.</td></tr>:null}</tbody>
    </table></div> : null}
  </section>;
}
