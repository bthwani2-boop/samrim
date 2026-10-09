"use client";
import { TextArea } from "@bthwani/design-system/web";

import type { CatalogAttributeDefinition, CatalogAttributeRule } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../session/session-provider";

type ValueKind = CatalogAttributeDefinition["valueKind"];
type RuleDraft = Pick<CatalogAttributeRule, "required" | "filterable" | "variantAxis">;
const valueKindLabels: Record<ValueKind, string> = { TEXT: "نص", INTEGER: "عدد صحيح", DECIMAL: "عدد عشري", BOOLEAN: "نعم أو لا", ENUM: "قائمة خيارات", MEASUREMENT: "قياس", DATE: "تاريخ" };

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  return "تعذر تنفيذ العملية.";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message || "تعذر تنفيذ العملية.");
  return body as T;
}

export function CatalogAttributePolicyWorkspace({ verticalId, categoryId }: { verticalId: string; categoryId: string }) {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("catalog") === true;
  const [definitions, setDefinitions] = useState<ReadonlyArray<CatalogAttributeDefinition>>([]);
  const [rules, setRules] = useState<ReadonlyArray<CatalogAttributeRule>>([]);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [definitionNames, setDefinitionNames] = useState<Record<string, string>>({});
  const [changeReason, setChangeReason] = useState("");
  const [selectedAttributeId, setSelectedAttributeId] = useState("");
  const [options, setOptions] = useState<ReadonlyArray<{ optionValue: string; active: boolean; ordinal: number; version: number }>>([]);
  const [optionOrdinals, setOptionOrdinals] = useState<Record<string, string>>({});
  const [optionValue, setOptionValue] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [code, setCode] = useState(() => `attr_${crypto.randomUUID().replaceAll("-", "")}`);
  const [valueKind, setValueKind] = useState<ValueKind>("TEXT");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDefinitions = useCallback(async (nextVerticalId: string) => {
    if (!nextVerticalId) {
      setDefinitions([]);
      setRules([]);
      setDrafts({});
      return;
    }
    setLoading(true);
    setError("");
    try {
      const definitionResponse = await fetch(`/api/catalog/attributes?verticalId=${encodeURIComponent(nextVerticalId)}&includeInactive=true`, { cache: "no-store" });
      const definitionBody = await parseResponse<{ definitions: ReadonlyArray<CatalogAttributeDefinition> }>(definitionResponse);
      setDefinitions(definitionBody.definitions);
      setDefinitionNames(Object.fromEntries(definitionBody.definitions.map((item) => [item.id, item.nameAr])));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRules = useCallback(async (nextCategoryId: string) => {
    if (!nextCategoryId) { setRules([]); setDrafts({}); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(nextCategoryId)}/attribute-rules`, { cache: "no-store" });
      const body = await parseResponse<{ rules: ReadonlyArray<CatalogAttributeRule> }>(response);
      setRules(body.rules);
      setDrafts(Object.fromEntries(body.rules.map((rule) => [rule.attributeId, { required: rule.required, filterable: rule.filterable, variantAxis: rule.variantAxis }])));
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDefinitions(verticalId); }, [verticalId, loadDefinitions]);
  useEffect(() => { void loadRules(categoryId); }, [categoryId, loadRules]);

  const selectedAttribute = useMemo(() => definitions.find((item) => item.id === selectedAttributeId) ?? null, [definitions, selectedAttributeId]);

  async function createDefinition() {
    if (!canEdit || !verticalId) return;
    const normalizedReason = changeReason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق التغيير."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/catalog/attributes", { method: "POST", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ verticalId, code: code.trim().toLowerCase(), nameAr: nameAr.trim(), valueKind, active: true, reason: normalizedReason }) });
      const body = await parseResponse<{ definition: CatalogAttributeDefinition }>(response);
      setNameAr(""); setCode(`attr_${crypto.randomUUID().replaceAll("-", "")}`); setSelectedAttributeId(body.definition.id); setNotice("تم حفظ الخاصية."); await loadDefinitions(verticalId);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function createOption() {
    if (!canEdit || !selectedAttribute || selectedAttribute.valueKind !== "ENUM" || !optionValue.trim()) return;
    const normalizedReason = changeReason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق التغيير."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(selectedAttribute.id)}/enum-options`, { method: "POST", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ optionValue: optionValue.trim(), active: true, ordinal: options.length, reason: normalizedReason }) });
      await parseResponse(response);
      setOptionValue(""); setNotice("تمت إضافة خيار الخاصية."); await loadOptions(selectedAttribute.id);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function loadOptions(attributeId: string) {
    try {
      const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(attributeId)}/enum-options?includeInactive=true`, { cache: "no-store" });
      const nextOptions = (await parseResponse<{ options: typeof options }>(response)).options;
      setOptions(nextOptions);
      setOptionOrdinals(Object.fromEntries(nextOptions.map((item) => [item.optionValue, String(item.ordinal)])));
    } catch (value) { setError(errorMessage(value)); }
  }

  async function updateDefinition(definition: CatalogAttributeDefinition, nextActive: boolean, nextNameAr = definitionNames[definition.id] ?? definition.nameAr) {
    if (!canEdit) return;
    const normalizedReason = changeReason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق التغيير."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(definition.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ nameAr: nextNameAr.trim(), active: nextActive, expectedVersion: definition.version, reason: normalizedReason }) });
      const body = await parseResponse<{ definition: CatalogAttributeDefinition }>(response);
      setNotice(`تم تحديث الخاصية: ${body.definition.nameAr}.`);
      await loadDefinitions(verticalId);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function updateOption(option: (typeof options)[number], active: boolean, ordinal = option.ordinal) {
    if (!canEdit || !selectedAttribute) return;
    const normalizedReason = changeReason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) { setError("أدخل سببًا من 5 إلى 500 حرف لتوثيق التغيير."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const path = `/api/catalog/attributes/${encodeURIComponent(selectedAttribute.id)}/enum-options/${encodeURIComponent(option.optionValue)}`;
      const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ active, ordinal, expectedVersion: option.version, reason: normalizedReason }) });
      const body = await parseResponse<{ option: (typeof options)[number] }>(response);
      setNotice(`تم تحديث خيار الخاصية: ${body.option.optionValue}.`);
      await loadOptions(selectedAttribute.id);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function saveRule(attributeId: string) {
    if (!canEdit || !categoryId) return;
    const draft = drafts[attributeId];
    if (!draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const currentRule = rules.find((item) => item.attributeId === attributeId);
      const normalizedReason = changeReason.trim();
      if (normalizedReason.length < 5 || normalizedReason.length > 500) throw new Error("أدخل سببًا من 5 إلى 500 حرف لتوثيق تغيير القاعدة.");
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(categoryId)}/attribute-rules/${encodeURIComponent(attributeId)}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...draft, expectedVersion: currentRule?.version ?? 0, reason: normalizedReason }) });
      const body = await parseResponse<{ rules: ReadonlyArray<CatalogAttributeRule> }>(response);
      setRules(body.rules); setNotice("تم تحديث قواعد خصائص الفئة.");
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  return <div className="catalog-attribute-compact">
    <label className="field-label" htmlFor="attribute-rule-reason">سبب التغيير<TextArea id="attribute-rule-reason" className="resize-none" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} disabled={busy || !canEdit} minLength={5} maxLength={500} /></label>
    <div className="catalog-attribute-definition">
        <strong>خاصية جديدة للمجال</strong>
        <p className="muted">تُعاد الاستفادة من تعريف الخاصية داخل فئات المجال.</p>
        <label className="field-label" htmlFor="attribute-name-ar">الاسم العربي<input id="attribute-name-ar" value={nameAr} onChange={(event) => setNameAr(event.target.value)} disabled={busy || !canEdit || !verticalId} maxLength={160} /></label>
        <label className="field-label" htmlFor="attribute-kind">نوع القيمة<select id="attribute-kind" value={valueKind} onChange={(event) => setValueKind(event.target.value as ValueKind)} disabled={busy || !canEdit || !verticalId}>{(Object.keys(valueKindLabels) as ValueKind[]).map((kind) => <option key={kind} value={kind}>{valueKindLabels[kind]}</option>)}</select></label>
        <button type="button" className="button button-secondary" disabled={busy || !canEdit || !verticalId || !nameAr.trim() || !code.trim() || changeReason.trim().length < 5} onClick={() => void createDefinition()}>إضافة الخاصية</button>
    </div>
    <div className="catalog-attribute-definition-list">
      <strong>تعريفات المجال</strong>
      {loading ? <p>جارٍ قراءة التعريفات…</p> : definitions.length === 0 ? <p>لا توجد تعريفات خصائص لهذا المجال بعد.</p> : <ul>{definitions.map((definition) => {
        const nameDraft = definitionNames[definition.id] ?? definition.nameAr;
        return <li key={definition.id}>
          <label className="field-label" htmlFor={`attribute-name-${definition.id}`}>اسم الخاصية<input id={`attribute-name-${definition.id}`} value={nameDraft} onChange={(event) => setDefinitionNames((current) => ({ ...current, [definition.id]: event.target.value }))} disabled={busy || !canEdit} maxLength={160} /></label>
          <span>{definition.active ? "نشطة" : "متوقفة"} · الإصدار {definition.version}</span>
          <div className="catalog-registry-actions">
            <button type="button" className="button button-secondary" disabled={busy || !canEdit || nameDraft.trim().length < 2 || nameDraft.trim() === definition.nameAr || changeReason.trim().length < 5} onClick={() => void updateDefinition(definition, definition.active, nameDraft)}>حفظ اسم الخاصية {definition.nameAr}</button>
            <button type="button" className="button button-secondary" disabled={busy || !canEdit || changeReason.trim().length < 5} onClick={() => void updateDefinition(definition, !definition.active, definition.nameAr)}>{definition.active ? `إيقاف الخاصية ${definition.nameAr}` : `تفعيل الخاصية ${definition.nameAr}`}</button>
          </div>
        </li>;
      })}</ul>}
    </div>
    <div className="catalog-attribute-options">
        <strong>خيارات قيم الخصائص</strong>
        <label className="field-label" htmlFor="attribute-option-select">خاصية التعداد<select id="attribute-option-select" value={selectedAttributeId} disabled={busy} onChange={(event) => { const id = event.target.value; setSelectedAttributeId(id); setOptions([]); if (id) void loadOptions(id); }}><option value="">اختر خاصية لها قائمة خيارات</option>{definitions.filter((item) => item.valueKind === "ENUM").map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
        {selectedAttribute?.valueKind === "ENUM" ? <><label className="field-label" htmlFor="attribute-option-value">قيمة الخيار<input id="attribute-option-value" value={optionValue} onChange={(event) => setOptionValue(event.target.value)} disabled={busy || !canEdit || !selectedAttribute.active} maxLength={160} /></label><button type="button" className="button button-secondary" disabled={busy || !canEdit || !selectedAttribute.active || !optionValue.trim() || changeReason.trim().length < 5} onClick={() => void createOption()}>إضافة خيار</button><ul>{options.map((option) => <li key={option.optionValue}>
          <span>{option.optionValue} · {option.active ? "نشط" : "متوقف"}</span>
          <label className="field-label">ترتيب الخيار {option.optionValue}<input type="number" min={0} max={100} value={optionOrdinals[option.optionValue] ?? String(option.ordinal)} disabled={busy || !canEdit} onChange={(event) => setOptionOrdinals((current) => ({ ...current, [option.optionValue]: event.target.value }))} /></label>
          <div className="catalog-registry-actions">
            <button type="button" className="button button-secondary" disabled={busy || !canEdit || changeReason.trim().length < 5 || Number(optionOrdinals[option.optionValue] ?? option.ordinal) === option.ordinal} onClick={() => void updateOption(option, option.active, Number(optionOrdinals[option.optionValue] ?? option.ordinal))}>حفظ ترتيب الخيار {option.optionValue}</button>
            <button type="button" className="button button-secondary" disabled={busy || !canEdit || changeReason.trim().length < 5} onClick={() => void updateOption(option, !option.active)}>{option.active ? `إيقاف الخيار ${option.optionValue}` : `تفعيل الخيار ${option.optionValue}`}</button>
          </div>
        </li>)}</ul></> : <p>اختر خاصية لها قائمة خيارات لإدارة قيمها.</p>}
    </div>
    <div className="catalog-attribute-rules">
      <strong>متطلبات الفئة للمنتج</strong>
      <p className="muted">حدد الخصائص المطلوبة أو التي تصنع نسخة مستقلة من المنتج.</p>
      {loading ? <p>جارٍ قراءة القواعد…</p> : !categoryId ? <p>اختر فئة لقراءة قواعدها.</p> : definitions.length === 0 ? <p>لا توجد تعريفات خصائص لهذه النشاط الرئيسي بعد.</p> : <ul>{definitions.map((definition) => {
        const rule = rules.find((item) => item.attributeId === definition.id);
        const draft = drafts[definition.id] ?? { required: rule?.required ?? false, filterable: rule?.filterable ?? false, variantAxis: rule?.variantAxis ?? false };
        return <li key={definition.id}><div><strong>{definition.nameAr}</strong><span> · {valueKindLabels[definition.valueKind]}</span><div className="field-row"><label><input type="checkbox" checked={draft.required} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, required: event.target.checked } }))} /> مطلوب</label><label><input type="checkbox" checked={draft.filterable} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, filterable: event.target.checked } }))} /> قابل للتصفية</label><label><input type="checkbox" checked={draft.variantAxis} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, variantAxis: event.target.checked } }))} /> يميز خيارات المنتج</label></div></div><button type="button" className="button button-secondary" disabled={busy || !canEdit || !categoryId || changeReason.trim().length < 5} onClick={() => void saveRule(definition.id)}>حفظ القاعدة</button></li>;
      })}</ul>}
    </div>
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => { if (verticalId) void loadDefinitions(verticalId); if (categoryId) void loadRules(categoryId); }}>إعادة المحاولة</button></p> : null}
  </div>;
}
