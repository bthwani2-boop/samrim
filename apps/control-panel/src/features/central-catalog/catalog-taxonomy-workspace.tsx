"use client";

import type { CatalogCategoryListResponse, CommerceVertical, CommercialStoreType, ShoppingShortcut, ShoppingShortcutListResponse } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { CatalogCategoryRegistry } from "./catalog-category-registry";
import { CatalogCommercialStoreTypeRegistry } from "./catalog-commercial-store-type-registry";
import { CatalogShoppingShortcutEditor } from "./catalog-shopping-shortcut-registry";
import {
  buildCategoryListParams,
  canLoadMoreCategories,
  matchesTaxonomyName,
  sortTaxonomyRows,
  taxonomyResourceForView,
  taxonomyResultSummary,
  visibleTaxonomyVertical,
} from "./catalog-taxonomy-query";
import { CatalogVerticalRegistry } from "./catalog-vertical-registry";

type Kind = "vertical" | "type" | "category" | "shortcut";
type Status = "all" | "active" | "inactive";
type CatalogRow = Readonly<{ id: string; kind: Kind; nameAr: string; nameEn: string; active: boolean; context: string; imageUri?: string | null | undefined }>;
type Editor = Readonly<{ kind: Kind; id?: string | undefined; sequence: number }>;
const kindLabels: Record<Kind, string> = {
  vertical: "مجال", type: "نوع متجر", category: "فئة منتجات", shortcut: "اختصار تسوق",
};
const viewLabels: Record<Kind, string> = {
  vertical: "المجالات التجارية", type: "أنواع المتاجر", category: "فئات المنتجات", shortcut: "اختصارات التسوق",
};
const searchLabels: Record<Kind, string> = {
  vertical: "ابحث عن مجال", type: "ابحث عن نوع متجر", category: "ابحث عن فئة", shortcut: "ابحث عن اختصار تسوق",
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذّر قراءة القائمة.");
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
  const [kind, setKind] = useState<Kind>("category");
  const [status, setStatus] = useState<Status>("all");
  const [pageSort, setPageSort] = useState<"default" | "name_asc" | "name_desc">("default");
  const [loading, setLoading] = useState(true);
  const [loadingScope, setLoadingScope] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const categoryRequest = useRef(0);
  const scopeRequest = useRef(0);
  const scopeLoadRequest = useRef(0);
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

  const loadCategories = useCallback(async (id: string, text: string, filterStatus: Status, sort: "default" | "name_asc" | "name_desc", cursor = "", append = false) => {
    const request = ++categoryRequest.current;
    if (!id) { setCategories([]); setNextCursor(""); return; }
    const params = buildCategoryListParams({ verticalId: id, query: text, status: filterStatus, sort, cursor });
    try {
      const body = await readResponse<CatalogCategoryListResponse>(
        await fetch(`/api/catalog/categories?${params}`, { cache: "no-store" }),
      );
      if (request !== categoryRequest.current) return;
      setCategories((old) => append ? [...old, ...body.categories] : body.categories);
      setNextCursor(body.nextCursor ?? "");
    } catch (cause) {
      if (request !== categoryRequest.current) return;
      if (!append) {
        setCategories([]);
        setNextCursor("");
      }
      setError(cause instanceof Error ? cause.message : "تعذّر تحميل فئات المنتجات.");
    }
  }, []);

  const loadRelated = useCallback(async (id: string, registryKind: "type" | "shortcut") => {
    const request = ++scopeRequest.current;
    if (!id) {
      if (registryKind === "type") setTypes([]);
      else setShortcuts([]);
      return;
    }
    try {
      if (registryKind === "type") {
        const body = await readResponse<{ storeTypes: ReadonlyArray<CommercialStoreType> }>(
          await fetch(`/api/catalog/commercial-store-types?${new URLSearchParams({ verticalId: id, includeInactive: "true" })}`, { cache: "no-store" }),
        );
        if (request === scopeRequest.current) setTypes(body.storeTypes);
      } else {
        const body = await readResponse<ShoppingShortcutListResponse>(
          await fetch(`/api/catalog/shopping-shortcuts?${new URLSearchParams({ verticalId: id })}`, { cache: "no-store" }),
        );
        if (request === scopeRequest.current) setShortcuts(body.shortcuts);
      }
    } catch (cause) {
      if (request !== scopeRequest.current) return;
      if (registryKind === "type") setTypes([]);
      else setShortcuts([]);
      setError(cause instanceof Error ? cause.message : "تعذّر تحميل العناصر. أعد المحاولة.");
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearchedQuery(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const request = ++scopeLoadRequest.current;
    // Invalidate requests from the previous view before starting new reads.
    categoryRequest.current += 1;
    scopeRequest.current += 1;
    setError("");
    setLoadingScope(true);
    const resource = taxonomyResourceForView(kind);
    const reads = resource === "categories"
      ? [loadCategories(verticalId, searchedQuery, status, pageSort)]
      : resource === "types" || resource === "shortcuts"
        ? [loadRelated(verticalId, kind === "type" ? "type" : "shortcut")]
        : [];
    void Promise.all(reads).finally(() => {
      if (request === scopeLoadRequest.current) setLoadingScope(false);
    });
  }, [kind, verticalId, searchedQuery, status, pageSort, loadCategories, loadRelated]);

  const refreshShortcut = useCallback(async (saved: ShoppingShortcut) => {
    const request = scopeRequest.current;
    const body = await readResponse<ShoppingShortcutListResponse>(
      await fetch(`/api/catalog/shopping-shortcuts?${new URLSearchParams({ verticalId })}`, { cache: "no-store" }),
    );
    const current = body.shortcuts.find((shortcut) => shortcut.id === saved.id);
    if (!current || current.version < saved.version) throw new Error("تعذر تأكيد قراءة الاختصار المحفوظ. احتفظنا بالمسودة؛ أعد المحاولة.");
    if (request !== scopeRequest.current) throw new Error("تغير نطاق البيانات أثناء تأكيد الحفظ. أعد القراءة.");
    setShortcuts(body.shortcuts);
  }, [verticalId]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const resource = taxonomyResourceForView(kind);
      await Promise.all([
        loadVerticals(),
        ...(resource === "categories" ? [loadCategories(verticalId, searchedQuery, status, pageSort)] : []),
        ...(resource === "types" || resource === "shortcuts" ? [loadRelated(verticalId, kind === "type" ? "type" : "shortcut")] : []),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تحديث القائمة.");
    }
  }, [kind, loadVerticals, loadCategories, loadRelated, verticalId, searchedQuery, status, pageSort]);

  const selectedVertical = verticals.find((v) => v.id === verticalId);
  const rows = useMemo((): CatalogRow[] => {
    const result: CatalogRow[] = verticals
      .filter((v) => visibleTaxonomyVertical(kind, verticalId, v.id))
      .map((v) => ({ id: v.id, kind: "vertical", nameAr: v.nameAr, nameEn: v.nameEn, active: v.active, context: "نشاط تجاري رئيسي", imageUri: v.imageUri }));
    result.push(...types.map((t) => ({ id: t.id, kind: "type" as const, nameAr: t.nameAr, nameEn: t.nameEn, active: t.active, context: selectedVertical?.nameAr ?? "" })));
    result.push(...categories.map((c) => ({ id: c.id, kind: "category" as const, nameAr: c.nameAr, nameEn: c.nameEn, active: c.active, context: c.pathAr || selectedVertical?.nameAr || "", imageUri: c.imageUri })));
    result.push(...shortcuts.map((s) => ({ id: s.id, kind: "shortcut" as const, nameAr: s.titleAr, nameEn: "", active: s.active, context: `${s.storeTypeIds.length} نوع متجر · ${s.categoryIds.length} فئة` })));
    return result.filter((item) => item.kind === kind && (status === "all" || item.active === (status === "active"))
      && matchesTaxonomyName(item, searchedQuery));
  }, [verticals, verticalId, types, categories, shortcuts, kind, status, searchedQuery, selectedVertical?.nameAr]);

  const visibleRows = useMemo(() => loadingScope ? [] : sortTaxonomyRows(rows, pageSort, kind), [rows, pageSort, kind, loadingScope]);
  function openEditor(nextKind: Kind, id?: string) {
    setEditor({ kind: nextKind, id, sequence: ++serial.current });
    if (nextKind === "category" && id) setCategoryId(id);
  }

  const shortcutToEdit = editor?.kind === "shortcut" && editor.id
    ? shortcuts.find((shortcut) => shortcut.id === editor.id)
    : undefined;

  return <AdaptiveRecordWorkspace preferenceKey="catalog-taxonomy" open={Boolean(editor)}
    triggerKey={editor ? editor.kind + ":" + (editor.id ?? "new") : ""}
    onClose={() => setEditor(null)}
    detail={editor ? <AdaptiveRecordPanel title={(editor.id ? "تعديل" : "إضافة") + " " + kindLabels[editor.kind]}
      subtitle={editor.id ? rows.find((item) => item.kind === editor.kind && item.id === editor.id)?.nameAr ?? "" : editor.kind === "vertical" ? "جميع المجالات التجارية" : selectedVertical?.nameAr ?? "اختر المجال"}
      onClose={() => setEditor(null)}>
        <div className="unified-taxonomy-drawer-body" key={editor.sequence}>
          {editor.kind === "vertical" ? <CatalogVerticalRegistry verticals={verticals} selectedVerticalId={verticalId}
            onSelectVertical={setVerticalId} onSaved={refresh} editorOnly initialId={editor.id} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "type" && verticalId ? <CatalogCommercialStoreTypeRegistry verticals={verticals} verticalId={verticalId}
            initialId={editor.id} onSaved={refresh} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "category" && verticalId ? <CatalogCategoryRegistry verticals={verticals} verticalId={verticalId}
            onVerticalChange={setVerticalId} categories={categories} nextCursor={nextCursor}
            onFilter={(text, filter, _sort, cursor, append) => loadCategories(verticalId, text, filter, pageSort, cursor, append)}
            categoryId={categoryId} onCategoryChange={setCategoryId} loading={loadingScope} onSaved={refresh}
            onManageVerticals={() => openEditor("vertical")} editorOnly initialId={editor.id} onClose={() => setEditor(null)} /> : null}
          {editor.kind === "shortcut" && verticalId ? (
            editor.id && !shortcutToEdit
              ? <div role="alert" className="identity-error">
                تعذر العثور على الاختصار المحدد. أعد قراءة القائمة قبل التحرير.
                <button type="button" onClick={() => void refresh()}>إعادة القراءة</button>
                <button type="button" onClick={() => setEditor(null)}>إغلاق</button>
              </div>
              : <CatalogShoppingShortcutEditor key={`${verticalId}:${editor.id ?? "new"}`} verticalId={verticalId}
                initialShortcut={shortcutToEdit} onSaved={refreshShortcut} onClose={() => setEditor(null)} />
          ) : null}
        </div>
    </AdaptiveRecordPanel> : null}>
  <section className="unified-taxonomy" aria-label="التصنيفات التجارية الموحدة">
    <header className="unified-taxonomy-header">
      <p className="unified-taxonomy-description">أدر النشاط التجاري للمتجر وأنواعه وفئات منتجاته واختصارات التسوق، دون خلط وظائفها.</p>
      <div className="unified-taxonomy-create">
        <button type="button" className="button button-primary"
          disabled={!canEdit || (kind !== "vertical" && !selectedVertical?.active)}
          onClick={() => openEditor(kind)}>＋ إضافة {kindLabels[kind]}</button>
      </div>
    </header>
    <fieldset className="unified-taxonomy-views">
      <legend className="sr-only">اختر ما تريد إدارته</legend>
      {(["category", "type", "vertical", "shortcut"] as const).map((value) =>
        <button key={value} type="button" aria-pressed={kind === value}
          className={`unified-taxonomy-view${kind === value ? " is-active" : ""}`}
          onClick={() => {
            if (value === kind) return;
            if (editor && !window.confirm("تغيير القسم سيغلق المحرر الحالي وقد يفقد التعديلات غير المحفوظة. هل تريد المتابعة؟")) return;
            setKind(value);
            setQuery("");
            setSearchedQuery("");
            setStatus("all");
            setPageSort("default");
            setEditor(null);
          }}>
          {viewLabels[value]}
        </button>)}
    </fieldset>
    <div className="unified-taxonomy-controls">
      <label className="unified-taxonomy-search">{searchLabels[kind]}
        <input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "category" ? "ابحث باسم الفئة ضمن المجال المختار…" : "ابحث بالاسم…"} />
      </label>
      {kind !== "vertical" ? <label>المجال التجاري
        <select value={verticalId} onChange={(event) => { setVerticalId(event.target.value); setQuery(""); setSearchedQuery(""); setCategoryId(""); setEditor(null); }}>
          {!verticalId ? <option value="">{verticals.length === 0 ? "لا توجد مجالات" : "اختر المجال"}</option> : null}
          {verticals.map((v) => <option key={v.id} value={v.id}>{v.nameAr}{v.active ? "" : " — معطّل"}</option>)}
        </select>
      </label> : <p className="unified-taxonomy-scope">جميع المجالات التجارية، دون تقييد بالمجال المختار سابقًا.</p>}
      <label>{kind === "category" ? "ترتيب الفئات" : "ترتيب العناصر"}
        <select value={kind === "category" && pageSort === "default" ? "name_asc" : pageSort} onChange={(event) => setPageSort(event.target.value as typeof pageSort)}>
          {kind !== "category" ? <option value="default">الترتيب الأصلي</option> : null}
          <option value="name_asc">الاسم أ–ي</option>
          <option value="name_desc">الاسم ي–أ</option>
        </select>
      </label>
      <details className="unified-taxonomy-advanced"><summary className="button button-secondary">تصفية إضافية{status !== "all" ? " · مفعّلة" : ""}</summary><div>
        <label>الحالة<select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
          <option value="all">جميع الحالات</option><option value="active">نشط</option><option value="inactive">متوقف</option>
        </select></label>
        {(query || status !== "all") ? <button type="button" className="button button-secondary unified-taxonomy-reset"
          onClick={() => { setQuery(""); setSearchedQuery(""); setStatus("all"); }}>مسح الفلاتر</button> : null}
      </div></details>
    </div>
    {error ? <div className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void refresh()}>إعادة المحاولة</button></div> : null}
    <div className="unified-taxonomy-count">
      <span>{loading || loadingScope ? "جارٍ تحميل العناصر…" : taxonomyResultSummary(rows.length, kind, Boolean(nextCursor))}</span>
      {kind === "vertical" ? <span>جميع المجالات المسجلة</span> : !verticalId ? <span>اختر مجالًا لعرض العناصر التابعة له.</span> : <span>المجال: {selectedVertical?.nameAr ?? "غير متاح"}</span>}
    </div>
    <div className="unified-taxonomy-table-wrap">
      <table className="unified-taxonomy-table">
        <thead><tr>
          <th scope="col">العنصر</th>
          <th scope="col">النوع</th>
          <th scope="col">{kind === "category" ? "مسار الفئة" : kind === "vertical" ? "التصنيف" : kind === "type" ? "يتبع المجال" : "الارتباطات"}</th>
          <th scope="col">الحالة</th>
          <th scope="col">الإجراء</th>
        </tr></thead>
        <tbody>
          {visibleRows.map((item) => <tr key={`${item.kind}:${item.id}`}>
            <td><div className="unified-taxonomy-identity">
              {item.imageUri ? <img src={item.imageUri} alt="" loading="lazy" /> : <span className="unified-taxonomy-monogram" aria-hidden="true">{item.nameAr.slice(0, 1)}</span>}
              <div><strong>{item.nameAr}</strong>{item.nameEn ? <small dir="ltr">{item.nameEn}</small> : null}</div>
            </div></td>
            <td><span className={`unified-taxonomy-kind is-${item.kind}`}>{kindLabels[item.kind]}</span></td>
            <td className="unified-taxonomy-context">{item.context}</td>
            <td><span className={`catalog-state-pill ${item.active ? "is-active" : "is-inactive"}`}>{item.active ? "نشط" : "متوقف"}</span></td>
            <td><button type="button" className="catalog-row-action" data-adaptive-record-trigger={item.kind + ":" + item.id} disabled={!canEdit} onClick={() => openEditor(item.kind, item.id)}
              aria-label={`تعديل ${kindLabels[item.kind]} ${item.nameAr}`}>تعديل</button></td>
          </tr>)}
          {!loading && !loadingScope && rows.length === 0 ? <tr><td colSpan={5} className="unified-taxonomy-empty">لا توجد نتائج مطابقة. غيّر المجال أو المرشحات.</td></tr> : null}
        </tbody>
      </table>
      <ul className="unified-taxonomy-mobile" aria-label={viewLabels[kind]}>
        {visibleRows.map((item) => <li key={`${item.kind}:${item.id}`} className="unified-taxonomy-mobile-card">
          <div className="unified-taxonomy-mobile-heading">
            <strong>{item.nameAr}</strong>
            <span className={`catalog-state-pill ${item.active ? "is-active" : "is-inactive"}`}>{item.active ? "نشط" : "متوقف"}</span>
          </div>
          <div className="unified-taxonomy-mobile-meta"><span>{kindLabels[item.kind]}</span><span>{item.context}</span></div>
          <button type="button" className="button button-secondary" data-adaptive-record-trigger={item.kind + ":" + item.id} disabled={!canEdit} onClick={() => openEditor(item.kind, item.id)} aria-label={`تعديل ${kindLabels[item.kind]} ${item.nameAr}`}>تعديل</button>
        </li>)}
        {!loading && !loadingScope && rows.length === 0 ? <li className="collection-state">لا توجد نتائج مطابقة.</li> : null}
      </ul>
    </div>
    {verticalId && canLoadMoreCategories(kind, Boolean(nextCursor)) ?
      <button type="button" className="button button-secondary unified-taxonomy-more" disabled={loadingScope}
        onClick={() => void loadCategories(verticalId, searchedQuery, status, pageSort, nextCursor, true)}>تحميل المزيد من الفئات</button> : null}
  </section>
  </AdaptiveRecordWorkspace>;
}
