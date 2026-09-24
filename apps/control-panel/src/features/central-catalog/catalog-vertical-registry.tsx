"use client";

import type { CommerceVertical } from "@bthwani/dsh";
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

export function CatalogVerticalRegistry({ verticals, onSaved }: { verticals: ReadonlyArray<CommerceVertical>; onSaved: () => Promise<void> }) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [selected, setSelected] = useState<CommerceVertical | null>(null);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [catalogModel, setCatalogModel] = useState<"SHARED_CATALOG" | "STORE_LOCAL_CATALOG" | "">("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function create() {
    if (!canEdit) return;
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    const normalizedReason = reason.trim();
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) {
      setError("يجب أن يتراوح الاسم العربي والإنجليزي بين حرفين و160 حرفًا.");
      return;
    }
    if (!catalogModel) { setError("حدد مسار إدخال المنتجات لهذا المجال قبل الحفظ."); return; }
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق الإضافة."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected ? `/api/catalog/verticals/${encodeURIComponent(selected.id)}` : "/api/catalog/verticals", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ nameAr: normalizedNameAr, nameEn: normalizedNameEn, catalogModel, active, reason: normalizedReason, ...(selected ? { expectedVersion: selected.version } : {}) }),
      });
      const payload = await parseResponse<{ vertical: CommerceVertical }>(response);
      setNotice(selected ? `تم تحديث الفئة الرئيسية: ${payload.vertical.nameAr}.` : `تم حفظ الفئة الرئيسية: ${payload.vertical.nameAr}.`);
      setSelected(null);
      setEditorOpen(false);
      setNameAr("");
      setNameEn("");
      setCatalogModel("");
      setReason("");
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء الفئة الرئيسية.");
    } finally {
      setBusy(false);
    }
  }

  function edit(vertical: CommerceVertical) {
    setSelected(vertical);
    setEditorOpen(true);
    setNameAr(vertical.nameAr);
    setNameEn(vertical.nameEn);
    setCatalogModel(vertical.catalogModel ?? "");
    setActive(vertical.active);
    setReason("");
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setSelected(null);
    setEditorOpen(false);
    setNameAr("");
    setNameEn("");
    setCatalogModel("");
    setActive(true);
    setReason("");
  }

  return (
    <section className="catalog-taxonomy-section" aria-labelledby="catalog-vertical-registry-title">
      <div className="access-card-heading">
        <span className="step-chip">قاموس التجارة</span>
        <p className="eyebrow">الفئات الرئيسية</p>
        <h3 id="catalog-vertical-registry-title">الفئات الرئيسية</h3>
        <p className="muted">تُحمّل السجلات من DSH. افتح سجلًا للتعديل أو أنشئ فئة رئيسية عند الحاجة.</p>
        {!editorOpen ? <button type="button" className="button button-primary" disabled={!canEdit} onClick={() => { setSelected(null); setNameAr(""); setNameEn(""); setCatalogModel(""); setActive(true); setReason(""); setEditorOpen(true); }}>إضافة فئة رئيسية</button> : null}
      </div>
      {editorOpen ? <div className="access-form">
        <label className="field-label" htmlFor="catalog-vertical-name-ar">الاسم العربي<input id="catalog-vertical-name-ar" disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="مطاعم" /></label>
        <label className="field-label" htmlFor="catalog-vertical-name-en">الاسم الإنجليزي<input id="catalog-vertical-name-en" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Restaurants" /></label>
        <label className="field-label" htmlFor="catalog-vertical-model">مسار إدخال المنتجات<select id="catalog-vertical-model" disabled={busy || !canEdit} value={catalogModel} onChange={(event) => setCatalogModel(event.target.value as typeof catalogModel)}><option value="">حدد المسار</option><option value="SHARED_CATALOG">منتجات مشتركة موحّدة</option><option value="STORE_LOCAL_CATALOG">قائمة منتجات يملكها المتجر</option></select></label>
        <label className="field-label" htmlFor="catalog-vertical-active"><input id="catalog-vertical-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط عند الإنشاء</label>
        <label className="field-label" htmlFor="catalog-vertical-reason">سبب الإضافة<textarea id="catalog-vertical-reason" disabled={busy || !canEdit} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" className="button button-primary" disabled={busy || !canEdit || reason.trim().length < 5} onClick={() => void create()}>{busy ? "جارٍ الحفظ…" : selected ? "حفظ التعديل" : "إضافة فئة رئيسية"}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={cancelEdit}>{selected ? "إلغاء التعديل" : "إغلاق"}</button>
      </div> : null}
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void onSaved()}>إعادة المحاولة</button></p> : null}
      <div className="catalog-taxonomy-inline">
        <strong>الفئات الرئيسية في السجل الكانوني</strong>
        {verticals.length === 0 ? <p>لا توجد فئات عليا بعد. أضف فئة قبل إنشاء طلب شريك أو منتج.</p> : <div className="catalog-registry-table-wrap"><table className="catalog-registry-table"><thead><tr><th>الفئة الرئيسية</th><th>الاسم الدولي</th><th>نموذج الكتالوج</th><th>الحالة</th><th>الإصدار</th><th>الإجراء</th></tr></thead><tbody>{verticals.map((vertical) => <tr key={vertical.id}><td><strong>{vertical.nameAr}</strong></td><td><bdi dir="ltr">{vertical.nameEn}</bdi></td><td>{vertical.catalogModel === "SHARED_CATALOG" ? "منتجات مشتركة" : vertical.catalogModel === "STORE_LOCAL_CATALOG" ? "قائمة المتجر" : "غير محدد"}</td><td>{vertical.active ? "نشط" : "متوقف"}</td><td>v{vertical.version}</td><td><button type="button" className="catalog-row-action" disabled={busy || !canEdit} onClick={() => edit(vertical)}>تعديل</button></td></tr>)}</tbody></table></div>}
      </div>
    </section>
  );
}
