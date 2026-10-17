"use client";

import type { CatalogCategoryListResponse, CommerceVertical, CommercialStoreType, ShoppingShortcut, ShoppingShortcutListResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { CatalogCategoryRegistry } from "./catalog-category-registry";
import { CatalogCommercialStoreTypeRegistry } from "./catalog-commercial-store-type-registry";
import { CatalogShoppingShortcutRegistry } from "./catalog-shopping-shortcut-registry";
import { CatalogVerticalRegistry } from "./catalog-vertical-registry";

type Kind = "vertical" | "type" | "category" | "shortcut";
type Status = "all" | "active" | "inactive";
type CatalogRow = Readonly<{ id: string; kind: Kind; nameAr: string; nameEn: string; active: boolean; context: string; imageUri?: string | null | undefined }>;
type Editor = Readonly<{ kind: Kind; id?: string | undefined; sequence: number }>;
const kindLabels: Record<Kind, string> = {
  vertical: "مجال", type: "نوع متجر", category: "فئة منتجات", shortcut: "اختصار تسوق",
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذّر قراءة التصنيفات.");
  return body as T;
}

export function CatalogTaxonomyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [categories, setCategories] = useState<CatalogCategoryListResponse["categories"]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [types, setTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [shortcuts, setShortcuts] = useState<ReadonlyArray<ShoppingShortcut>>([]);
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [status, setStatus] = useState<Status>("all");
  const [loading, setLoading] = useState(true);
  const [loadingScope, setLoadingScope] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [chooseKind, setChooseKind] = useState(false);
  const categoryRequest = useRef(0);
  const scopeRequest = useRef(0);
  const serial = useRef(0);

  const loadVerticals = useCallback(async () => {
    const body = await readResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(
      await fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" }),
    );
    setVerticals(body.verticals);
    const requested = new URL(window.location.href).searchParams.get("verticalId") ?? "";
    setVerticalId((current) => {
      const preferred = current || requested;
      return body.verticals.some((v) => v.id === preferred) ? preferred : body.verticals.find((v) => v.active)?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void loadVerticals().catch((cause) => setError(cause instanceof Error ? cause.message : "تعذّر تحميل المجالات."))
      .finally(() => setLoading(false));
  }, [loadVerticals]);

  const loadCategories = useCallback(async (id: string, text: string, filterStatus: Status, cursor = "", append = false) => {
    const request = ++categoryRequest.current;
    if (!id) { setCategories([]); setNextCursor(""); return; }
    const params = new URLSearchParams({ verticalId: id, status: filterStatus, sort: "name_asc", limit: "100" });
    if (text.trim()) params.set("query", text.trim());
    if (cursor) params.set("cursor", cursor);
    try {
      const body = await readResponse<CatalogCategoryListResponse>(
        await fetch(`/api/catalog/categories?${params}`, { cache: "no-store" }),
      );
      if (request !== categoryRequest.current) return;
      setCategories((old) => append ? [...old, ...body.categories] : body.categories);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (request === categoryRequest.current) setError(cause instanceof Error ? cause.message : "تعذّر تحميل فئات المنتجات.");
    }
  }, []);

  const loadRelated = useCallback(async (id: string) => {
    const request = ++scopeRequest.current;
    if (!id) { setTypes([]); setShortcuts([]); return; }
    try {
      const [typeBody, shortcutBody] = await Promise.all([
        fetch(`/api/catalog/commercial-store-types?${new URLSearchParams({ verticalId: id, includeInactive: "true" })}`, { cache: "no-store" })
          .then((res) => readResponse<{ storeTypes: ReadonlyArray<CommercialStoreType> }>(res)),
        fetch(`/api/catalog/shopping-shortcuts?${new URLSearchParams({ verticalId: id })}`, { cache: "no-store" })
          .then((res) => readResponse<ShoppingShortcutListResponse>(res)),
      ]);
      if (request !== scopeRequest.current) return;
      setTypes(typeBody.storeTypes);
      setShortcuts(shortcutBody.shortcuts);
    } catch (cause) {
      if (request === scopeRequest.current) setError(cause instanceof Error ? cause.message : "تعذّر تحميل الأنواع والاختصارات.");
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearchedQuery(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setError("");
    setLoadingScope(true);
    void Promise.all([loadCategories(verticalId, searchedQuery, status), loadRelated(verticalId)])
      .finally(() => setLoadingScope(false));
  }, [verticalId, searchedQuery, status, loadCategories, loadRelated]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      await Promise.all([loadVerticals(), loadCategories(verticalId, searchedQuery, status), loadRelated(verticalId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تحديث القائمة.");
    }
  }, [loadVerticals, loadCategories, loadRelated, verticalId, searchedQuery, status]);

  useEffect(() => {
    if (!editor) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditor(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  const selectedVertical = verticals.find((v) => v.id === verticalId);
  const rows = useMemo((): CatalogRow[] => {
    const result: CatalogRow[] = verticals
      .filter((v) => !verticalId || v.id === verticalId)
      .map((v) => ({ id: v.id, kind: "vertical", nameAr: v.nameAr, nameEn: v.nameEn, active: v.active, context: "مجال رئيسي", imageUri: v.imageUri }));
    result.push(...types.map((t) => ({ id: t.id, kind: "type" as const, nameAr: t.nameAr, nameEn: t.nameEn, active: t.active, context: selectedVertical?.nameAr ?? "" })));
    result.push(...categories.map((c) => ({ id: c.id, kind: "category" as const, nameAr: c.nameAr, nameEn: c.nameEn, active: c.active, context: c.pathAr || selectedVertical?.nameAr || "", imageUri: c.imageUri })));
    result.push(...shortcuts.map((s) => ({ id: s.id, kind: "shortcut" as const, nameAr: s.titleAr, nameEn: "", active: s.active, context: `${s.storeTypeIds.length} نوع متجر · ${s.categoryIds.length} فئة` })));
    const search = searchedQuery.toLocaleLowerCase();
    return result.filter((item) => (kind === "all" || item.kind === kind) && (status === "all" || item.active === (status === "active"))
      && (!search || [item.nameAr, item.nameEn, item.context, kindLabels[item.kind]].some((value) => value.toLocaleLowerCase().includes(search))));
  }, [verticals, verticalId, types, categories, shortcuts, kind, status, searchedQuery, selectedVertical?.nameAr]);

  function openEditor(nextKind: Kind, id?: string) {
    setEditor({ kind: nextKind, id, sequence: ++serial.current });
    setChooseKind(false);
    if (nextKind === "category" && id) setCategoryId(id);
  }

  return <section className="unified-taxonomy" aria-label="التصنيفات الموحدة">
    <header className="unified-taxonomy-header">
      <p className="unified-taxonomy-description">المجالات وأنواع المتاجر وفئات المنتجات واختصارات التسوق · إدارة واحدة</p>
      <div className="unified-taxonomy-create">
        <button type="button" className="button button-primary" disabled={!canEdit} aria-expanded={chooseKind}
          onClick={() => setChooseKind((value) => !value)}>＋ إضافة عنصر</button>
        {chooseKind ? <fieldset className="unified-taxonomy-create-menu" aria-label="نوع العنصر الجديد">
          {(["vertical", "type", "category", "shortcut"] as const).map((value) =>
            <button key={value} type="button" disabled={value !== "vertical" && !selectedVertical?.active}
              onClick={() => openEditor(value)}>إضافة {kindLabels[value]}</button>)}
        </fieldset> : null}
      </div>
    </header>
    <div className="unified-taxonomy-controls">
      <label className="unified-taxonomy-search">بحث شامل
        <input type="search" maxLength={160} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو المسار…" />
      </label>
      <label>المجال
        <select value={verticalId} onChange={(e) => { setVerticalId(e.target.value); setCategoryId(""); setEditor(null); }}>
          {verticals.length === 0 ? <option value="">لا توجد مجالات</option> : null}
          {verticals.map((v) => <option key={v.id} value={v.id}>{v.nameAr}{v.active ? "" : " — معطّل"}</option>)}
        </select>
      </label>
      <label>نوع العنصر
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind | "all")}>
          <option value="all">جميع الأنواع</option>
          {(["vertical", "type", "category", "shortcut"] as const).map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}
        </select>
      </label>
      <details className="unified-taxonomy-advanced"><summary className="button button-secondary">تصفية إضافية{status !== "all" ? " · مفعّلة" : ""}</summary><div>
        <label>الحالة<select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          <option value="all">جميع الحالات</option><option value="active">نشط</option><option value="inactive">متوقف</option>
        </select></label>
        {(query || kind !== "all" || status !== "all") ? <button type="button" className="button button-secondary unified-taxonomy-reset" onClick={() => { setQuery(""); setStatus("all"); setKind("all"); }}>مسح الفلاتر</button> : null}
      </div></details>
    </div>
    {error ? <div className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void refresh()}>إعادة المحاولة</button></div> : null}
    <div className="unified-taxonomy-count">
      <span>{loading || loadingScope ? "جارٍ تحميل التصنيفات…" : `${rows.length}${nextCursor ? "+" : ""} عنصر`}</span>
      {!verticalId ? <span>اختر مجالًا لعرض الأنواع والفئات والاختصارات التابعة له.</span> : null}
    </div>
    <div className="unified-taxonomy-table-wrap">
      <table className="unified-taxonomy-table">
        <thead><tr><th scope="col">العنصر</th><th scope="col">النوع</th><th scope="col">المجال / العلاقة</th><th scope="col">الحالة</th><th scope="col">الإجراء</th></tr></thead>
        <tbody>
          {rows.map((item) => <tr key={`${item.kind}:${item.id}`}>
            <td><div className="unified-taxonomy-identity">
              {item.imageUri ? <img src={item.imageUri} alt="" loading="lazy" /> : <span className="unified-taxonomy-monogram" aria-hidden="true">{item.nameAr.slice(0, 1)}</span>}
              <div><strong>{item.nameAr}</strong>{item.nameEn ? <small dir="ltr">{item.nameEn}</small> : null}</div>
            </div></td>
            <td><span className={`unified-taxonomy-kind is-${item.kind}`}>{kindLabels[item.kind]}</span></td>
            <td className="unified-taxonomy-context">{item.context}</td>
            <td><span className={`catalog-state-pill ${item.active ? "is-active" : "is-inactive"}`}>{item.active ? "نشط" : "متوقف"}</span></td>
            <td><button type="button" className="catalog-row-action" disabled={!canEdit} onClick={() => openEditor(item.kind, item.id)}
              aria-label={`تعديل ${kindLabels[item.kind]} ${item.nameAr}`}>تعديل</button></td>
          </tr>)}
          {!loading && !loadingScope && rows.length === 0 ? <tr><td colSpan={5} className="unified-taxonomy-empty">لا توجد نتائج مطابقة. غيّر المجال أو المرشحات.</td></tr> : null}
        </tbody>
      </table>
    </div>
    {nextCursor && verticalId && (kind === "all" || kind === "category") ?
      <button type="button" className="button button-secondary unified-taxonomy-more" disabled={loadingScope}
        onClick={() => void loadCategories(verticalId, searchedQuery, status, nextCursor, true)}>تحميل المزيد من الفئات</button> : null}
    {editor ? <div className="unified-taxonomy-overlay">
      <aside className="unified-taxonomy-drawer" role="dialog" aria-modal="true" aria-label={`${editor.id ? "تعديل" : "إضافة"} ${kindLabels[editor.kind]}`} dir="rtl">
        <div className="unified-taxonomy-drawer-header"><div><strong>{editor.id ? "تعديل" : "إضافة"} {kindLabels[editor.kind]}</strong><small>{editor.id ? rows.find((item) => item.kind === editor.kind && item.id === editor.id)?.nameAr ?? "" : selectedVertical?.nameAr ?? "سجل جديد"}</small></div>
          <button type="button" className="button button-secondary" aria-label="إغلاق لوحة التحرير" onClick={() => setEditor(null)}>✕</button>
        </div>
        <div className="unified-taxonomy-drawer-body" key={editor.sequence}>
          {editor.kind === "vertical" ? <CatalogVerticalRegistry verticals={verticals} selectedVerticalId={verticalId}
            onSelectVertical={setVerticalId} onSaved={refresh} editorOnly initialId={editor.id} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "type" && verticalId ? <CatalogCommercialStoreTypeRegistry verticals={verticals} verticalId={verticalId}
            editorOnly initialId={editor.id} onSaved={refresh} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "category" && verticalId ? <CatalogCategoryRegistry verticals={verticals} verticalId={verticalId}
            onVerticalChange={setVerticalId} categories={categories} nextCursor={nextCursor}
            onFilter={(text, filter, _sort, cursor, append) => loadCategories(verticalId, text, filter, cursor, append)}
            categoryId={categoryId} onCategoryChange={setCategoryId} loading={loadingScope} onSaved={refresh}
            onManageVerticals={() => openEditor("vertical")} editorOnly initialId={editor.id} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "shortcut" && verticalId ? <CatalogShoppingShortcutRegistry verticalId={verticalId}
            editorOnly initialId={editor.id} onSaved={refresh} onClose={() => setEditor(null)} /> : null}
        </div>
      </aside>
    </div> : null}
  </section>;
}
