"use client";
import { TextArea } from "@bthwani/design-system/web";
import type { CommerceVertical, CommercialStoreType } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { RegistryColumnHeader } from "../shared/registry-column-header";

type TypeListResponse = Readonly<{ storeTypes: ReadonlyArray<CommercialStoreType> }>;

function saveActionLabel(busy: boolean, hasSelection: boolean): string {
  if (busy) return "جارٍ الحفظ…";
  if (hasSelection) return "حفظ نوع المتجر";
  return "إنشاء نوع المتجر";
}

function message(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "تعذر تنفيذ العملية.";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "تعذر تنفيذ العملية.";
  const text = (error as { message?: unknown }).message;
  return typeof text === "string" && text.trim() ? text : "تعذر تنفيذ العملية.";
}

async function readTypes(verticalId: string): Promise<ReadonlyArray<CommercialStoreType>> {
  const query = new URLSearchParams({ verticalId, includeInactive: "true" });
  const response = await fetch(`/api/catalog/commercial-store-types?${query}`, { cache: "no-store" });
  const body = await response.json() as TypeListResponse | { error?: unknown };
  if (!response.ok || !("storeTypes" in body)) throw new Error(message(body));
  return body.storeTypes;
}

function CommercialStoreTypeRegistryFeedback({ verticalId, vertical, notice, error, loading, itemCount }: Readonly<{
  verticalId: string;
  vertical: CommerceVertical | undefined;
  notice: string;
  error: string;
  loading: boolean;
  itemCount: number;
}>) {
  return <>
    {verticalId && !vertical?.active ? <output className="managed-status managed-status-warning">المجال متوقف؛ يمكن مراجعة الأنواع، لكن لا يمكن إنشاء نوع جديد فيه.</output> : null}
    {notice ? <output className="managed-status managed-status-success">{notice}</output> : null}
    {error ? <p className="identity-error" role="alert">{error}</p> : null}
    {loading ? <output>جارٍ قراءة سجل أنواع المتاجر…</output> : null}
    {verticalId && !loading && itemCount === 0 && !error ? <p className="muted">لا توجد أنواع متجر مسجلة لهذا المجال بعد.</p> : null}
  </>;
}

export function CatalogCommercialStoreTypeRegistry({ verticals, verticalId, editorOnly = false, initialId, onSaved, onClose }: Readonly<{ verticals: ReadonlyArray<CommerceVertical>; verticalId: string; editorOnly?: boolean; initialId?: string | undefined; onSaved?: () => Promise<void>; onClose?: () => void }>) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [items, setItems] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const initialized = useRef(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [selected, setSelected] = useState<CommercialStoreType | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [listStatus, setListStatus] = useState("all");
  const filteredTypes = items.filter((item) =>
    (!listQuery.trim() || [item.nameAr,item.nameEn].some(x=>x.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase())))
    && (listStatus==="all" || item.active === (listStatus==="active"))
  );
  const vertical = verticals.find((item) => item.id === verticalId);
  const saveLabel = saveActionLabel(busy, Boolean(selected));

  const reload = useCallback(async () => {
    if (!verticalId) { setItems([]); return; }
    setLoading(true);
    setError("");
    try { setItems(await readTypes(verticalId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة أنواع المتاجر."); }
    finally { setLoading(false); }
  }, [verticalId]);

  const edit = useCallback((item: CommercialStoreType) => {
    setSelected(item);
    setEditorOpen(true);
    setNameAr(item.nameAr);
    setNameEn(item.nameEn);
    setActive(item.active);
    setReason("");
    setError("");
    setNotice("");
  }, []);

  const clearEditor = useCallback(() => {
    setSelected(null);
    setEditorOpen(false);
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
  }, []);

  useEffect(() => { clearEditor(); setNotice(""); void reload(); }, [clearEditor, reload]);
  useReadOnReturn(() => reload(), !editorOnly && Boolean(verticalId) && !loading && !busy && !editorOpen);
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
      setEditorOpen(true);
    }
  }, [editorOnly, initialId, items, clearEditor, edit]);

  async function save() {
    if (!canEdit || !verticalId) return;
    const cleanAr = nameAr.trim();
    const cleanEn = nameEn.trim();
    const cleanReason = reason.trim();
    if (cleanAr.length < 2 || cleanAr.length > 160 || cleanEn.length < 2 || cleanEn.length > 160 || cleanReason.length < 5 || cleanReason.length > 500) {
      setError("أدخل الاسمين العربي والإنجليزي وسببًا موثقًا من 5 إلى 500 حرف.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected ? `/api/catalog/commercial-store-types/${encodeURIComponent(selected.id)}` : "/api/catalog/commercial-store-types", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(selected
          ? { nameAr: cleanAr, nameEn: cleanEn, active, expectedVersion: selected.version, reason: cleanReason }
          : { verticalId, nameAr: cleanAr, nameEn: cleanEn, active, reason: cleanReason }),
      });
      const payload = await response.json() as { storeType?: CommercialStoreType; error?: unknown };
      if (!response.ok || !payload.storeType) throw new Error(message(payload));
      setNotice(`${selected ? "تم تحديث" : "تم إنشاء"} نوع المتجر «${payload.storeType.nameAr}».`);
      clearEditor();
      await reload();
      if (editorOnly) { await onSaved?.(); onClose?.(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ نوع المتجر.");
    } finally { setBusy(false); }
  }

  return <section className="catalog-taxonomy-section" aria-labelledby="commercial-store-type-title">
    {!editorOnly ? <div className="access-card-heading">

      <h3 id="commercial-store-type-title">أنواع المتاجر التجارية</h3>

      {vertical ? <p className="muted">المجال التجاري: <strong>{vertical.nameAr}</strong></p> : <p className="muted">اختر مجالًا تجاريًا لعرض أنواعه.</p>}
      {!editorOpen ? <button type="button" className="button button-primary" disabled={!canEdit || !verticalId || !vertical?.active || busy} onClick={() => { clearEditor(); setEditorOpen(true); setNotice(""); }}>نوع متجر جديد</button> : null}
    </div> : null}
    <CommercialStoreTypeRegistryFeedback verticalId={verticalId} vertical={vertical} notice={notice} error={error} loading={loading} itemCount={items.length} />
    {editorOpen || (editorOnly && !initialId) ? <div className="access-form">
      <label className="field-label" htmlFor="commercial-type-name-ar">الاسم العربي<input id="commercial-type-name-ar" disabled={busy || !canEdit || !vertical?.active} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="ملحمة" /></label>
      <label className="field-label" htmlFor="commercial-type-name-en">الاسم الإنجليزي<input id="commercial-type-name-en" disabled={busy || !canEdit || !vertical?.active} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Butcher" /></label>
      <label className="field-label"><input type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط للاستخدام في ملفات الانضمام والسياسات</label>
      <label className="field-label" htmlFor="commercial-type-reason">سبب التغيير<TextArea className="resize-none" rows={2} id="commercial-type-reason" disabled={busy || !canEdit} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="catalog-registry-actions unified-taxonomy-save-actions"><button type="button" className="button button-primary" disabled={busy || !canEdit || !vertical?.active} onClick={() => void save()}>{saveLabel}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => { clearEditor(); if (editorOnly) onClose?.(); }}>إلغاء</button></div>
    </div> : null}
    {!editorOnly && items.length > 0 ? <div className="catalog-registry-table-wrap"><table className="catalog-registry-table"><thead><tr>
          <RegistryColumnHeader label="النوع التجاري" active={Boolean(listQuery)}>
            <label>بحث عن نوع المتجر<input type="search" value={listQuery} onChange={e=>setListQuery(e.target.value)} /></label>
          </RegistryColumnHeader>
          <th scope="col">الاسم الدولي</th>
          <RegistryColumnHeader label="الحالة" active={listStatus!=="all"}>
            <label>الحالة<select value={listStatus} onChange={e=>setListStatus(e.target.value)}>
              <option value="all">كل الحالات</option><option value="active">نشط</option><option value="inactive">متوقف</option>
            </select></label>
          </RegistryColumnHeader>
          <th scope="col">الإجراء</th>
        </tr></thead><tbody>{filteredTypes.map((item) => <tr key={item.id}><td><strong>{item.nameAr}</strong></td><td><bdi dir="ltr">{item.nameEn}</bdi></td><td>{item.active ? "نشط" : "متوقف"}</td><td><button type="button" className="catalog-row-action" disabled={busy || !canEdit} onClick={() => edit(item)}>تعديل</button></td></tr>)}{filteredTypes.length===0?<tr><td colSpan={4}>لا توجد أنواع متجر مطابقة.</td></tr>:null}</tbody></table></div> : null}
  </section>;
}
