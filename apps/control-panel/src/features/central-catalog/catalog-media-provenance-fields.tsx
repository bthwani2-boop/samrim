"use client";

import type { MediaProvenanceInput } from "@bthwani/dsh";

export function appendMediaProvenance(form: FormData, value: MediaProvenanceInput): void {
  form.set("creator", value.creator.trim());
  form.set("sourceDescription", value.sourceDescription.trim());
  form.set("sourceUri", value.sourceUri?.trim() ?? "");
  form.set("rightsStatement", value.rightsStatement.trim());
  form.set("rightsUri", value.rightsUri?.trim() ?? "");
  form.set("rightsAttested", String(value.rightsAttested));
}

export function CatalogMediaProvenanceFields({ idPrefix, disabled, value, onChange }: {
  idPrefix: string;
  disabled: boolean;
  value: MediaProvenanceInput;
  onChange: (value: MediaProvenanceInput) => void;
}) {
  return <fieldset className="catalog-media-provenance">
    <legend>مصدر الصورة وحقوق استخدامها</legend>
    <label className="field-label" htmlFor={`${idPrefix}-creator`}>اسم المنشئ أو المصوّر<input id={`${idPrefix}-creator`} disabled={disabled} maxLength={200} value={value.creator} onChange={(event) => onChange({ ...value, creator: event.target.value })} /></label>
    <label className="field-label" htmlFor={`${idPrefix}-source`}>مصدر الصورة<textarea id={`${idPrefix}-source`} disabled={disabled} maxLength={1000} rows={2} value={value.sourceDescription} onChange={(event) => onChange({ ...value, sourceDescription: event.target.value })} /></label>
    <label className="field-label" htmlFor={`${idPrefix}-source-uri`}>رابط المصدر (اختياري)<input id={`${idPrefix}-source-uri`} disabled={disabled} type="url" maxLength={2048} value={value.sourceUri ?? ""} onChange={(event) => onChange({ ...value, sourceUri: event.target.value })} /></label>
    <label className="field-label" htmlFor={`${idPrefix}-rights`}>بيان الإذن أو الترخيص<textarea id={`${idPrefix}-rights`} disabled={disabled} maxLength={2000} rows={2} value={value.rightsStatement} onChange={(event) => onChange({ ...value, rightsStatement: event.target.value })} /></label>
    <label className="field-label" htmlFor={`${idPrefix}-rights-uri`}>رابط بيان الحقوق (اختياري)<input id={`${idPrefix}-rights-uri`} disabled={disabled} type="url" maxLength={2048} value={value.rightsUri ?? ""} onChange={(event) => onChange({ ...value, rightsUri: event.target.value })} /></label>
    <label className="central-active-toggle"><input id={`${idPrefix}-attested`} type="checkbox" disabled={disabled} checked={value.rightsAttested} onChange={(event) => onChange({ ...value, rightsAttested: event.target.checked })} /> أقرّ بوجود إذن يسمح بعرض هذه الصورة</label>
  </fieldset>;
}
