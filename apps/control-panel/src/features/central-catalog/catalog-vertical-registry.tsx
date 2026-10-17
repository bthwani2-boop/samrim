"use client";
import { TextArea } from "@bthwani/design-system/web";

import { type CommerceVertical, isMediaProvenanceInputValid, type MediaProvenanceInput } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { appendMediaProvenance, CatalogMediaProvenanceFields } from "./catalog-media-provenance-fields";

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

function verticalSelectionActionLabel(isSelected: boolean): string {
  return isSelected ? "المحدد" : "اختيار المجال";
}

function verticalSaveLabel(busy: boolean, isEditing: boolean): string {
  if (busy) return "جارٍ الحفظ…";
  if (isEditing) return "حفظ التعديل";
  return "إضافة مجال تجاري";
}

export function CatalogVerticalRegistry({ verticals, selectedVerticalId, onSelectVertical, onSaved, editorOnly = false, initialId, onClose }: { verticals: ReadonlyArray<CommerceVertical>; selectedVerticalId: string; onSelectVertical: (verticalId: string) => void; onSaved: () => Promise<void>; editorOnly?: boolean; initialId?: string | undefined; onClose?: () => void }) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [selected, setSelected] = useState<CommerceVertical | null>(null);
  const initialized = useRef(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [reason, setReason] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [mediaReason, setMediaReason] = useState("");
  const [mediaProvenance, setMediaProvenance] = useState<MediaProvenanceInput>({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!mediaFile) { setPreviewUri(null); return; }
    const uri = URL.createObjectURL(mediaFile);
    setPreviewUri(uri);
    return () => URL.revokeObjectURL(uri);
  }, [mediaFile]);

  async function create() {
    if (!canEdit || mediaBusy) return;
    const normalizedNameAr = nameAr.trim();
    const normalizedNameEn = nameEn.trim();
    const normalizedReason = reason.trim();
    if (normalizedNameAr.length < 2 || normalizedNameAr.length > 160 || normalizedNameEn.length < 2 || normalizedNameEn.length > 160) {
      setError("يجب أن يتراوح الاسم العربي والإنجليزي بين حرفين و160 حرفًا.");
      return;
    }
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق الإضافة."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(selected ? `/api/catalog/verticals/${encodeURIComponent(selected.id)}` : "/api/catalog/verticals", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ nameAr: normalizedNameAr, nameEn: normalizedNameEn, active, reason: normalizedReason, ...(selected ? { expectedVersion: selected.version } : {}) }),
      });
      const payload = await parseResponse<{ vertical: CommerceVertical }>(response);
      setNotice(selected ? `تم تحديث المجال التجاري: ${payload.vertical.nameAr}.` : `تم حفظ المجال التجاري: ${payload.vertical.nameAr}.`);
      if (payload.vertical.active) onSelectVertical(payload.vertical.id);
      setSelected(null);
      setEditorOpen(false);
      setNameAr("");
      setNameEn("");
      setReason("");
      await onSaved();
      if (editorOnly) onClose?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إنشاء المجال التجاري.");
    } finally {
      setBusy(false);
    }
  }

  const edit = useCallback((vertical: CommerceVertical) => {
    setSelected(vertical);
    setEditorOpen(true);
    setNameAr(vertical.nameAr);
    setNameEn(vertical.nameEn);
    setActive(vertical.active);
    setReason("");
    setMediaFile(null);
    setImageMode(false);
    setMediaReason("");
    setMediaProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
    setError("");
    setNotice("");
  }, []);

  function cancelEdit() {
    if (editorOnly) onClose?.();
    setSelected(null);
    setEditorOpen(false);
    setNameAr("");
    setNameEn("");
    setActive(true);
    setReason("");
    setMediaFile(null);
    setImageMode(false);
    setMediaReason("");
    setMediaProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
  }

  useEffect(() => {
    if (!editorOnly || initialized.current) return;
    initialized.current = true;
    if (initialId) {
      const item = verticals.find((v) => v.id === initialId);
      if (item) edit(item);
    } else {
      setSelected(null); setNameAr(""); setNameEn(""); setActive(true); setReason(""); setEditorOpen(true);
    }
    // Each editor mounts once per selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOnly, initialId, verticals, edit]);

  async function uploadVerticalImage() {
    if (!canEdit || !selected || !mediaFile || !isMediaProvenanceInputValid(mediaProvenance) || mediaReason.trim().length < 5) return;
    setMediaBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.set("file", mediaFile, mediaFile.name || "vertical-image");
      body.set("reason", mediaReason.trim());
      appendMediaProvenance(body, mediaProvenance);
      const response = await fetch(`/api/catalog/verticals/${encodeURIComponent(selected.id)}/media`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(selected.version) },
        body,
      });
      const payload = await parseResponse<{ vertical: CommerceVertical }>(response);
      setSelected(payload.vertical);
      setMediaFile(null);
      setImageMode(false);
      setMediaReason("");
      setMediaProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
      setNotice(`تم إرفاق صورة المجال التجاري: ${payload.vertical.nameAr}.`);
      await onSaved();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "تعذر إرفاق صورة المجال التجاري.");
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <section className="catalog-taxonomy-section" aria-labelledby="catalog-vertical-registry-title">
      {!editorOnly ? <div className="access-card-heading">
        <h3 id="catalog-vertical-registry-title">المجالات التجارية</h3>
        {!editorOpen ? <button type="button" className="button button-primary" disabled={!canEdit} onClick={() => { setSelected(null); setNameAr(""); setNameEn(""); setActive(true); setReason(""); setEditorOpen(true); }}>إضافة مجال تجاري</button> : null}
      </div> : null}
      {editorOpen ? <div className="access-form unified-taxonomy-vertical-form">
        {!imageMode ? <>
          <label className="field-label" htmlFor="catalog-vertical-name-ar">الاسم بالعربية<input id="catalog-vertical-name-ar" maxLength={160} disabled={busy || !canEdit} value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder="مطاعم" /></label>
          <label className="field-label" htmlFor="catalog-vertical-name-en">الاسم بالإنجليزية<input id="catalog-vertical-name-en" maxLength={160} dir="auto" disabled={busy || !canEdit} value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="Restaurants" /></label>
          <label className="catalog-category-active-toggle"><input id="catalog-vertical-active" type="checkbox" disabled={busy || mediaBusy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> {selected ? "المجال نشط" : "تفعيل المجال"}</label>
          <label className="field-label" htmlFor="catalog-vertical-reason">سبب {selected ? "التعديل" : "الإضافة"}<TextArea id="catalog-vertical-reason" className="resize-none" rows={2} disabled={busy || !canEdit} minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <small className="muted">مطلوب لتوثيق التغيير · {reason.trim().length}/500</small>
          {selected ? <button type="button" className="unified-taxonomy-image-entry" disabled={busy || mediaBusy || !canEdit} onClick={() => { setImageMode(true); setError(""); }}>
            {selected.imageUri ? <img src={selected.imageUri} alt="" /> : <span className="unified-taxonomy-image-placeholder" aria-hidden="true">{selected.nameAr.slice(0, 1)}</span>}
            <span><strong>صورة المجال</strong><small>{selected.imageUri ? "تغيير الصورة الحالية" : "إضافة صورة للمجال"}</small></span>
            <span className="unified-taxonomy-image-entry-action" aria-hidden="true">تغيير</span>
          </button> : <p className="muted">يمكن إرفاق الصورة بعد إنشاء المجال.</p>}
          <div className="unified-taxonomy-save-actions">
            <button type="button" className="button button-primary" disabled={busy || mediaBusy || !canEdit || reason.trim().length < 5} onClick={() => void create()}>{verticalSaveLabel(busy, Boolean(selected))}</button>
            <button type="button" className="button button-secondary" disabled={busy || mediaBusy} onClick={cancelEdit}>إلغاء</button>
          </div>
        </> : selected ? <>
          <p className="unified-taxonomy-media-intro">صورة {selected.nameAr} · تُحفظ منفصلةً عن بيانات المجال</p>
          <div className="unified-taxonomy-image-picker">
            {previewUri || selected.imageUri ? <img src={previewUri || selected.imageUri || ""} alt={previewUri ? "معاينة الصورة المختارة" : "الصورة الحالية"} /> : <span className="unified-taxonomy-image-placeholder" aria-hidden="true">{selected.nameAr.slice(0, 1)}</span>}
            <div className="unified-taxonomy-image-picker-meta"><strong>{mediaFile ? "الصورة الجديدة" : "الصورة الحالية"}</strong>
              <small>{mediaFile ? mediaFile.name : selected.imageUri ? "اختر صورة لاستبدالها" : "اختر الصورة الأولى للمجال"}</small>
            </div>
            <label className="button button-secondary unified-taxonomy-file-trigger">{mediaFile ? "اختيار أخرى" : "اختيار صورة"}
              <input id="catalog-vertical-image" type="file" className="visually-hidden" accept="image/jpeg,image/png" disabled={busy || mediaBusy || !canEdit}
                onChange={(event) => { setMediaFile(event.target.files?.[0] ?? null); setMediaReason(selected.imageUri ? "استبدال صورة المجال التجاري" : "إرفاق صورة المجال التجاري"); setMediaProvenance({ creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false }); }} />
            </label>
          </div>
          {mediaFile ? <>
            <CatalogMediaProvenanceFields compact idPrefix="catalog-vertical-media" disabled={busy || mediaBusy || !canEdit} value={mediaProvenance} onChange={setMediaProvenance} />
            <p className="unified-taxonomy-media-hint">تُطلب بيانات المصدر والإذن مرة واحدة لهذه الصورة.</p>
          </> : <p className="unified-taxonomy-media-hint">اختر صورة أولًا، ثم وثّق مصدرها وحق استخدامها.</p>}
          <div className="unified-taxonomy-save-actions">
            <button type="button" className="button button-primary" disabled={busy || mediaBusy || !canEdit || !mediaFile || !isMediaProvenanceInputValid(mediaProvenance)} onClick={() => void uploadVerticalImage()}>{mediaBusy ? "جارٍ حفظ الصورة…" : "حفظ الصورة"}</button>
            <button type="button" className="button button-secondary" disabled={mediaBusy} onClick={() => { setImageMode(false); setMediaFile(null); setError(""); }}>رجوع</button>
          </div>
        </> : null}
      </div> : null}
      {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void onSaved()}>إعادة المحاولة</button></p> : null}
      {!editorOnly ? <div className="catalog-taxonomy-inline">
        <strong>سجل الأنشطة</strong>
        {verticals.length === 0 ? <p>لا توجد مجالات تجارية بعد. أضف مجالًا قبل إنشاء فئات المنتجات.</p> : <div className="catalog-registry-table-wrap"><table className="catalog-registry-table"><thead><tr><th>المجال التجاري</th><th>الاسم الدولي</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{verticals.map((vertical) => <tr key={vertical.id} className={selectedVerticalId === vertical.id ? "is-selected" : undefined}><td><div className="catalog-vertical-registry-identity">{vertical.imageUri ? <img src={vertical.imageUri} alt={`صورة ${vertical.nameAr}`} loading="lazy" decoding="async" /> : <span aria-hidden="true">{vertical.nameAr.slice(0, 1)}</span>}<strong>{vertical.nameAr}</strong></div></td><td><bdi dir="ltr">{vertical.nameEn}</bdi></td><td>{vertical.active ? "نشط" : "متوقف"}</td><td><div className="catalog-registry-actions"><button type="button" className="catalog-row-action" aria-pressed={selectedVerticalId === vertical.id} disabled={!vertical.active} onClick={() => onSelectVertical(vertical.id)}>{verticalSelectionActionLabel(selectedVerticalId === vertical.id)}</button><button type="button" className="catalog-row-action" disabled={busy || mediaBusy || !canEdit} onClick={() => edit(vertical)}>تعديل</button></div></td></tr>)}</tbody></table></div>}
      </div> : null}
    </section>
  );
}
