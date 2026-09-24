"use client";

import type { CatalogAttributeDefinition, CatalogAttributeRule, CatalogCategory, CommerceVertical } from "@bthwani/dsh";
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

export function CatalogAttributePolicyWorkspace() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [verticalId, setVerticalId] = useState("");
  const [categories, setCategories] = useState<ReadonlyArray<CatalogCategory>>([]);
  const [categoryId, setCategoryId] = useState("");
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

  const loadVerticals = useCallback(async () => {
    try {
      const response = await fetch("/api/catalog/verticals?includeInactive=true", { cache: "no-store" });
      setVerticals((await parseResponse<{ verticals: ReadonlyArray<CommerceVertical> }>(response)).verticals);
    } catch (value) {
      setError(errorMessage(value));
    }
  }, []);

  const loadScope = useCallback(async (nextVerticalId: string) => {
    if (!nextVerticalId) {
      setCategories([]);
      setDefinitions([]);
      setCategoryId("");
      setRules([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [categoryResponse, definitionResponse] = await Promise.all([
        fetch(`/api/catalog/categories?verticalId=${encodeURIComponent(nextVerticalId)}&includeInactive=true`, { cache: "no-store" }),
        fetch(`/api/catalog/attributes?verticalId=${encodeURIComponent(nextVerticalId)}&includeInactive=true`, { cache: "no-store" }),
      ]);
      const [categoryBody, definitionBody] = await Promise.all([
        parseResponse<{ categories: ReadonlyArray<CatalogCategory> }>(categoryResponse),
        parseResponse<{ definitions: ReadonlyArray<CatalogAttributeDefinition> }>(definitionResponse),
      ]);
      setCategories(categoryBody.categories);
      setDefinitions(definitionBody.definitions);
      setCategoryId("");
      setRules([]);
      setDrafts({});
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

  useEffect(() => { void loadVerticals(); }, [loadVerticals]);
  useEffect(() => { void loadScope(verticalId); }, [verticalId, loadScope]);
  useEffect(() => { void loadRules(categoryId); }, [categoryId, loadRules]);

  const selectedAttribute = useMemo(() => definitions.find((item) => item.id === selectedAttributeId) ?? null, [definitions, selectedAttributeId]);

  async function createDefinition() {
    if (!canEdit || !verticalId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/catalog/attributes", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ verticalId, code: code.trim().toLowerCase(), nameAr: nameAr.trim(), valueKind, active: true }) });
      const body = await parseResponse<{ definition: CatalogAttributeDefinition }>(response);
      setNameAr(""); setCode(""); setSelectedAttributeId(body.definition.id); setNotice("تم حفظ تعريف الخاصية في DSH."); await loadScope(verticalId);
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
      setRules(body.rules); setNotice("تم تحديث قواعد خصائص التصنيف.");
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }

  return <section className="access-card" aria-labelledby="catalog-attribute-policy-title">
    <div className="access-card-heading"><span className="step-chip">تعريفات DSH</span><p className="eyebrow">بيانات المنتجات</p><h2 id="catalog-attribute-policy-title">تعريف الخصائص وقواعد التصنيف</h2><p className="muted">تُعرّف الخاصية داخل مجالها، ثم تُربط بتصنيف وتُقرأ من السجل الكانوني قبل إدخال قيم المنتجات.</p></div>
    <div className="access-form">
      <label className="field-label" htmlFor="attribute-policy-vertical">المجال التجاري<select id="attribute-policy-vertical" value={verticalId} disabled={busy} onChange={(event) => setVerticalId(event.target.value)}><option value="">اختر مجالًا صراحةً</option>{verticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}{vertical.active ? "" : " · متوقف"}</option>)}</select></label>
      <label className="field-label" htmlFor="attribute-policy-category">التصنيف<select id="attribute-policy-category" value={categoryId} disabled={busy || !verticalId} onChange={(event) => setCategoryId(event.target.value)}><option value="">اختر تصنيفًا</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.nameAr}{category.active ? "" : " · متوقف"}</option>)}</select></label>
    </div>
    <div className="workspace-resource-grid">
      <section className="managed-status managed-status-info" aria-labelledby="attribute-definition-title">
        <strong id="attribute-definition-title">تعريف خاصية للمجال</strong>
        <label className="field-label" htmlFor="attribute-name-ar">الاسم العربي<input id="attribute-name-ar" value={nameAr} onChange={(event) => setNameAr(event.target.value)} disabled={busy || !canEdit || !verticalId} maxLength={160} /></label>
        <label className="field-label" htmlFor="attribute-code">المعرّف البرمجي<input id="attribute-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy || !canEdit || !verticalId} maxLength={64} dir="ltr" /></label>
        <label className="field-label" htmlFor="attribute-kind">نوع القيمة<select id="attribute-kind" value={valueKind} onChange={(event) => setValueKind(event.target.value as ValueKind)} disabled={busy || !canEdit || !verticalId}>{["TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "ENUM", "MEASUREMENT", "DATE"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <button type="button" className="button button-primary" disabled={busy || !canEdit || !verticalId || !nameAr.trim() || !code.trim()} onClick={() => void createDefinition()}>إضافة تعريف</button>
      </section>
      <section className="managed-status managed-status-info" aria-labelledby="attribute-options-title">
        <strong id="attribute-options-title">خيارات القيم</strong>
        <label className="field-label" htmlFor="attribute-option-select">خاصية التعداد<select id="attribute-option-select" value={selectedAttributeId} disabled={busy} onChange={(event) => { const id = event.target.value; setSelectedAttributeId(id); setOptions([]); if (id) void loadOptions(id); }}><option value="">اختر خاصية من النوع ENUM</option>{definitions.filter((item) => item.valueKind === "ENUM").map((item) => <option key={item.id} value={item.id}>{item.nameAr} · {item.code}</option>)}</select></label>
        {selectedAttribute?.valueKind === "ENUM" ? <><label className="field-label" htmlFor="attribute-option-value">قيمة الخيار<input id="attribute-option-value" value={optionValue} onChange={(event) => setOptionValue(event.target.value)} disabled={busy || !canEdit} maxLength={128} /></label><button type="button" className="button button-secondary" disabled={busy || !canEdit || !optionValue.trim()} onClick={() => void createOption()}>إضافة خيار</button><ul>{options.map((option) => <li key={option.optionValue}>{option.optionValue} · {option.active ? "نشط" : "متوقف"}</li>)}</ul></> : <p>اختر خاصية ENUM لإدارة قيمها.</p>}
      </section>
    </div>
    <section className="managed-status managed-status-info" aria-labelledby="attribute-rules-title">
      <strong id="attribute-rules-title">قواعد التصنيف المحدد</strong>
      <label className="field-label" htmlFor="attribute-rule-reason">سبب التغيير<textarea id="attribute-rule-reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} disabled={busy || !canEdit} minLength={5} maxLength={500} /></label>
      {loading ? <p>جارٍ قراءة القواعد…</p> : !categoryId ? <p>اختر تصنيفًا لقراءة قواعده.</p> : definitions.length === 0 ? <p>لا توجد تعريفات خصائص لهذا المجال بعد.</p> : <ul>{definitions.map((definition) => {
        const rule = rules.find((item) => item.attributeId === definition.id);
        const draft = drafts[definition.id] ?? { required: rule?.required ?? false, variantAxis: rule?.variantAxis ?? false };
        return <li key={definition.id}><div><strong>{definition.nameAr}</strong><span> · {definition.code} · {definition.valueKind}</span><div className="field-row"><label><input type="checkbox" checked={draft.required} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, required: event.target.checked } }))} /> مطلوب</label><label><input type="checkbox" checked={draft.variantAxis} disabled={busy || !canEdit} onChange={(event) => setDrafts((current) => ({ ...current, [definition.id]: { ...draft, variantAxis: event.target.checked } }))} /> محور نسخة</label></div></div><button type="button" className="button button-secondary" disabled={busy || !canEdit || !categoryId || changeReason.trim().length < 5} onClick={() => void saveRule(definition.id)}>حفظ القاعدة</button></li>;
      })}</ul>}
    </section>
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => verticalId ? void loadScope(verticalId) : void loadVerticals()}>إعادة المحاولة</button></p> : null}
  </section>;
}
