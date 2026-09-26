"use client";

import type { CatalogAttributeDefinition, CatalogAttributeRule } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../session/session-provider";

type ValueKind = CatalogAttributeDefinition["valueKind"];
type RuleDraft = Pick<CatalogAttributeRule, "required" | "variantAxis">;

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
  const [changeReason, setChangeReason] = useState("");
  const [selectedAttributeId, setSelectedAttributeId] = useState("");
  const [options, setOptions] = useState<ReadonlyArray<{ optionValue: string; active: boolean; ordinal: number }>>([]);
  const [optionValue, setOptionValue] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [code, setCode] = useState("");
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
      setDrafts(Object.fromEntries(body.rules.map((rule) => [rule.attributeId, { required: rule.required, variantAxis: rule.variantAxis }])));
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
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/catalog/attributes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ verticalId, code: code.trim().toLowerCase(), nameAr: nameAr.trim(), valueKind, active: true }) });
      const body = await parseResponse<{ definition: CatalogAttributeDefinition }>(response);
      setNameAr(""); setCode(""); setSelectedAttributeId(body.definition.id); setNotice("تم حفظ تعريف الخاصية في DSH."); await loadDefinitions(verticalId);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function createOption() {
    if (!canEdit || !selectedAttribute || selectedAttribute.valueKind !== "ENUM" || !optionValue.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(selectedAttribute.id)}/enum-options`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ optionValue: optionValue.trim(), active: true, ordinal: options.length }) });
      await parseResponse(response);
      setOptionValue(""); setNotice("تمت إضافة خيار الخاصية."); await loadOptions(selectedAttribute.id);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  async function loadOptions(attributeId: string) {
    try {
      const response = await fetch(`/api/catalog/attributes/${encodeURIComponent(attributeId)}/enum-options`, { cache: "no-store" });
      setOptions((await parseResponse<{ options: typeof options }>(response)).options);
    } catch (value) { setError(errorMessage(value)); }
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
      const response = await fetch(`/api/catalog/categories/${encodeURIComponent(categoryId)}/attribute-rules/${encodeURIComponent(attributeId)}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Correlation-ID": crypto.randomUUID(), "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...draft, filterable: false, expectedVersion: currentRule?.version ?? 0, reason: normalizedReason }) });
      const body = await parseResponse<{ rules: ReadonlyArray<CatalogAttributeRule> }>(response);
      setRules(body.rules); setNotice("تم تحديث قواعد خصائص الفئة.");
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  return <div className="catalog-taxonomy-section">
    <div className="access-card-heading"><span className="step-chip">خصائص DSH</span><p className="eyebrow">بيانات المنتجات</p><h3>خصائص الفئة المختارة وقواعدها</h3><p className="muted">اختر الفئة العليا والفئة من عناصر الشجرة أعلاه؛ تعريفات الخصائص وقواعدها تُقرأ وتُحفظ ضمن السياق نفسه.</p></div>
    <div className="workspace-resource-grid">
      <div className="catalog-taxonomy-inline">
        <strong>تعريف خاصية للفئة العليا المحددة</strong>
        <label className="field-label" htmlFor="attribute-name-ar">الاسم العربي<input id="attribute-name-ar" value={nameAr} onChange={(event) => setNameAr(event.target.value)} disabled={busy || !canEdit || !verticalId} maxLength={160} /></label>
        <label className="field-label" htmlFor="attribute-code">المعرّف البرمجي<input id="attribute-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy || !canEdit || !verticalId} maxLength={64} dir="ltr" /></label>
        <label className="field-label" htmlFor="attribute-kind">نوع القيمة<select id="attribute-kind" value={valueKind} onChange={(event) => setValueKind(event.target.value as ValueKind)} disabled={busy || !canEdit || !verticalId}>{["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "ENUM", "MEASUREMENT", "DATE"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <button type="button" className="button button-primary" disabled={busy || !canEdit || !verticalId || !nameAr.trim() || !code.trim()} onClick={() => void createDefinition()}>إضافة تعريف</button>
      </div>
      <div className="catalog-taxonomy-inline">
        <strong>خيارات قيم الخصائص</strong>
        <label className="field-label" htmlFor="attribute-option-select">خاصية التعداد<select id="attribute-option-select" value={selectedAttributeId} disabled={busy} onChange={(event) => { const id = event.target.value; setSelectedAttributeId(id); setOptions([]); if (id) void loadOptions(id); }}><option value="">اختر خاصية من النوع ENUM</option>{definitions.filter((item) => item.valueKind === "ENUM").map((item) => <option key={item.id} value={item.id}>{item.nameAr} · {item.code}</option>)}</select></label>
        {selectedAttribute?.valueKind === "ENUM" ? <><label className="field-label" htmlFor="attribute-option-value">قيمة الخيار<input id="attribute-option-value" value={optionValue} onChange={(event) => setOptionValue(event.target.value)} disabled={busy || !canEdit} maxLength={128} /></label><button type="button" className="button button-secondary" disabled={busy || !canEdit || !optionValue.trim()} onClick={() => void createOption()}>إضافة خيار</button><ul>{options.map((option) => <li key={option.optionValue}>{option.optionValue} · {option.active ? "نشط" : "متوقف"}</li>)}</ul></> : <p>اختر خاصية ENUM لإدارة قيمها.</p>}
      </div>
    </div>
    <div className="catalog-taxonomy-inline">
      <strong>قواعد الفئة المحددة</strong>
      <label className="field-label" htmlFor="attribute-rule-reason">سبب التغيير<textarea id="attribute-rule-reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} disabled={busy || !canEdit} minLength={5} maxLength={500} /></label>
      {loading ? <p>جارٍ قراءة القواعد…</p> : !categoryId ? <p>اختر فئة لقراءة قواعدها.</p> : definitions.length === 0 ? <p>لا توجد تعريفات خصائص لهذه الفئة الرئيسية بعد.</p> : <ul>{definitions.map((definition) => {
        const rule = rules.find((item) => item.attributeId === definition.id);
        const draft = drafts[definition.id] ?? { required: rule?.required ?? false, variantAxis: rule?.variantAxis ?? false };
        return <li key={definition.id}><div><strong>{definition.nameAr}</strong><span> · {definition.code} · {definition.valueKind}</span><div className="field-row"><label><input type="checkbox" checked={draft.required} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, required: event.target.checked } }))} /> مطلوب</label><label><input type="checkbox" checked={draft.variantAxis} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, variantAxis: event.target.checked } }))} /> محور نسخة</label></div></div><button type="button" className="button button-secondary" disabled={busy || !canEdit || !categoryId || changeReason.trim().length < 5} onClick={() => void saveRule(definition.id)}>حفظ القاعدة</button></li>;
      })}</ul>}
    </div>
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => { if (verticalId) void loadDefinitions(verticalId); if (categoryId) void loadRules(categoryId); }}>إعادة المحاولة</button></p> : null}
  </div>;
}
