"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HREmployee, HREmployeeInput, HREmployeePage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { EmployeeAccessRequest } from "./employee-access-request";
import { EmployeeAuditHistory } from "./employee-audit-history";
import { EmployeeEmploymentStatus } from "./employee-employment-status";
import { EmployeeManagerSelect } from "./employee-manager-select";
import { EmployeeOperatorAccess } from "./employee-operator-access";
import { EmployeeProfileEditor } from "./employee-profile-editor";

const blank: HREmployeeInput = {
  fullNameAr: "", phoneE164: "",
  department: "", jobTitle: "", managerEmployeeId: "",
  startDate: "", workLocation: "",
};

export function EmployeeDirectory() {
  const [form, setForm] = useState<HREmployeeInput>(blank);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<readonly HREmployee[]>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [selected, setSelected] = useState<HREmployee | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useRef<{ signature: string; key: string } | null>(null);

  const load = useCallback(async (overrides?: { q: string; cursor: string }) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: overrides?.q ?? applied, cursor: overrides?.cursor ?? cursor });
      const result = await identityFetch(`/api/hr/employees?${params.toString()}`);
      if (!result.ok) throw new Error("تعذر تحميل سجل الموظفين. تحقق من صلاحياتك أو حاول مجددًا.");
      const page = await result.json() as HREmployeePage;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setItems([]);
      setNextCursor("");
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الموظفين.");
    } finally { setLoading(false); }
  }, [applied, cursor]);

  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof HREmployeeInput>(key: K, value: HREmployeeInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    mutation.current = null;
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input: HREmployeeInput = {
      ...form, fullNameAr: form.fullNameAr.trim(), phoneE164: form.phoneE164.trim(),
      department: form.department.trim(), jobTitle: form.jobTitle.trim(),
      workLocation: form.workLocation.trim(),
    };
    if (input.fullNameAr.length < 2 || input.department.length === 0 || input.jobTitle.length === 0 ||
      input.workLocation.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ||
      (input.phoneE164 !== "" && !/^\+[1-9]\d{7,14}$/.test(input.phoneE164))) {
      setError("أكمل الاسم والقسم والمسمى وموقع العمل وتاريخ البداية، ورقم الهاتف للمشغّل.");
      return;
    }
    const signature = JSON.stringify(input);
    if (mutation.current?.signature !== signature) mutation.current = { signature, key: crypto.randomUUID() };
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": mutation.current.key },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        if (response.status === 409) {
          mutation.current = null;
          throw new Error("يوجد موظف مسجل بنفس البيانات أو تعارض في الطلب. راجع السجل قبل إعادة المحاولة.");
        }
        throw new Error(payload?.error?.message ?? "تعذر تسجيل الموظف.");
      }
      const result = await response.json() as { employee: HREmployee };
      mutation.current = null;
      setForm(blank);
      setFormOpen(false);
      setNotice("تم تسجيل الموظف في الموارد البشرية. لم يُمنح أي وصول للوحة التحكم.");
      setCursor("");
      setHistory([]);
      setApplied("");
      setQuery("");
      setSelected(result.employee);
      await load({ q: "", cursor: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الموظف. يمكنك إعادة المحاولة دون تكرار الطلب.");
    } finally { setSaving(false); }
  }

  return <section className="workspace-page access-page hr-directory" aria-labelledby="hr-title">
    <header className="access-section-heading">
      <div>
        <h1 id="hr-title">الموارد البشرية</h1>
        <p>سجل موظفي بثواني — يشمل المشغّلين والموظفين دون وصول إلى لوحة التحكم.</p>
      </div>
      <button type="button" className="button button-primary" onClick={() => { setFormOpen((v) => !v); setError(""); }} aria-expanded={formOpen} aria-controls="employee-create">إضافة موظف</button>
    </header>

    {formOpen ? <form id="employee-create" className="access-create-form" onSubmit={(event) => void save(event)}>
      <h2>ملف موظف جديد</h2>
      <p className="muted">إضافة الموظف لا تمنح صلاحيات دخول. وتُستكمل بيانات الراتب ضمن صلاحيات سرية لاحقًا.</p>
      <label className="field-label">الاسم الكامل<input required minLength={2} maxLength={120} autoComplete="name" value={form.fullNameAr} onChange={(e) => update("fullNameAr", e.target.value)} /></label>
      <label className="field-label">القسم<input required maxLength={80} value={form.department} onChange={(e) => update("department", e.target.value)} /></label>
      <label className="field-label">المسمى الوظيفي<input required maxLength={80} value={form.jobTitle} onChange={(e) => update("jobTitle", e.target.value)} /></label>
      <label className="field-label">تاريخ بدء العمل<input required type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} /></label>
      <label className="field-label">موقع العمل<input required maxLength={100} value={form.workLocation} onChange={(e) => update("workLocation", e.target.value)} /></label>
      <label className="field-label">رقم الهاتف (اختياري)<input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="+967777000100" value={form.phoneE164} onChange={(e) => update("phoneE164", e.target.value)} /></label>
      <EmployeeManagerSelect value={form.managerEmployeeId} initial={items} onChange={(id)=>update("managerEmployeeId",id)} disabled={saving}/>
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ الموظف"}</button>
        <button type="button" className="button button-secondary" disabled={saving} onClick={() => setFormOpen(false)}>إلغاء</button>
      </div>
    </form> : null}
    {notice ? <p role="status" className="success-inline">{notice}</p> : null}
    {error ? <div role="alert" className="managed-status managed-status-warning"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading || saving}>إعادة تحميل السجل</button></div> : null}
    <form className="form-actions" onSubmit={(e) => { e.preventDefault(); setApplied(query.trim()); setCursor(""); setHistory([]); }}>
      <label className="field-label">البحث عن موظف<input aria-label="ابحث عن موظف أو قسم" maxLength={80} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="الاسم أو القسم" /></label>
      <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
    </form>
    <div className="access-table-wrap" aria-busy={loading}>
      <table className="operations-table access-table">
        <caption className="visually-hidden">دليل موظفي بثواني</caption>
        <thead><tr><th scope="col">الموظف</th><th scope="col">القسم</th><th scope="col">المسمى</th><th scope="col">النوع</th><th scope="col">الحالة</th><th scope="col">التفاصيل</th></tr></thead>
        <tbody>{items.map((person) => <tr key={person.id}>
          <th scope="row">{person.fullNameAr}</th><td>{person.department}</td><td>{person.jobTitle}</td>
          <td>{person.operatorActorId ? "مرتبط بهوية تشغيل" : "بلا هوية تشغيل"}</td>
          <td>{person.status === "active" ? "نشط" : "غير نشط"}</td>
          <td><button className="button button-quiet" type="button" onClick={() => setSelected(person)}>التفاصيل</button></td>
        </tr>)}
        {!loading && items.length === 0 ? <tr><td colSpan={6}>لا يوجد موظفون مطابقون للبحث.</td></tr> : null}
        {loading ? <tr><td colSpan={6}>جارٍ تحميل الموظفين…</td></tr> : null}</tbody>
      </table>
    </div>
    <div className="form-actions">
      <button className="button button-secondary" type="button" disabled={history.length === 0 || loading} onClick={() => { const stack = [...history]; setCursor(stack.pop() ?? ""); setHistory(stack); }}>السابق</button>
      <button className="button button-secondary" type="button" disabled={!nextCursor || loading} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>التالي</button>
    </div>
    {selected ? <section className="access-workspace-section" aria-label="تفاصيل الموظف">
      <div className="access-section-heading"><h2>{selected.fullNameAr}</h2><button type="button" className="button button-quiet" onClick={() => setSelected(null)}>إغلاق</button></div>
      <dl>
        <dt>الرقم الوظيفي</dt><dd><bdi dir="ltr">{selected.id}</bdi></dd>
        <dt>القسم</dt><dd>{selected.department}</dd>
        <dt>المسمى</dt><dd>{selected.jobTitle}</dd>
        <dt>تاريخ الانضمام</dt><dd>{selected.startDate}</dd>
        <dt>موقع العمل</dt><dd>{selected.workLocation}</dd>
        <dt>الوصول للوحة التحكم</dt><dd>{selected.operatorActorId ? "هوية تشغيل مرتبطة؛ تحقق من حالة الوصول أدناه" : "لا توجد هوية تشغيل مرتبطة"}</dd>
      </dl>
      <EmployeeProfileEditor key={selected.id} employee={selected} colleagues={items} onSaved={(next)=>{setSelected(next);setItems((list)=>list.map((person)=>person.id===next.id?next:person))}} />
      <EmployeeAccessRequest key={`${selected.id}-access`} employee={selected} />
      <EmployeeOperatorAccess key={`${selected.id}-operator-access`} employee={selected} />
      <EmployeeEmploymentStatus key={`${selected.id}-employment-status`} employee={selected} onSaved={(next)=>{setSelected(next);setItems((list)=>list.map((person)=>person.id===next.id?next:person));}} />
      <EmployeeAuditHistory key={`${selected.id}-audit`} employee={selected} />
    </section> : null}
  </section>;
}
