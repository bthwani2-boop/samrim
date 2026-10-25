"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HREmployee, HREmployeeInput, HREmployeePage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { PageHeader } from "../../shell/page-header";
import { ActivityIndicator, ActivityLegend } from "../shared/record-indicator";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { EmployeeManagerSelect } from "./employee-manager-select";
import { EmployeeProfileWorkspace } from "./employee-profile-workspace";

const blank: HREmployeeInput = {
  fullNameAr: "", phoneE164: "",
  department: "", jobTitle: "", managerEmployeeId: "",
  startDate: "", workLocation: "",
};

function isEmployeePage(value: unknown): value is HREmployeePage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return Array.isArray(page.items) && (page.nextCursor === undefined || typeof page.nextCursor === "string") && page.items.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const employee = item as Record<string, unknown>;
    return ["id", "fullNameAr", "department", "jobTitle", "startDate", "workLocation", "createdAt"].every((key) => typeof employee[key] === "string")
      && (employee.status === "active" || employee.status === "inactive")
      && Number.isSafeInteger(employee.version) && Number(employee.version) > 0;
  });
}

export function EmployeeDirectory() {
  const [form, setForm] = useState<HREmployeeInput>(blank);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [identityFilter, setIdentityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [appliedFilters, setAppliedFilters] = useState({ department: "", jobTitle: "", status: "", linked: "" });
  const [items, setItems] = useState<readonly HREmployee[]>([]);
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const pageFiltered = Boolean(appliedFilters.department || appliedFilters.jobTitle || appliedFilters.status || appliedFilters.linked);
  // The displayed page has already been filtered by DSH, not by local table rows.
  const visibleItems = items;
  const mutation = useRef<{ signature: string; key: string } | null>(null);
  const loadRevision = useRef(0);

  const applyFilters = useCallback(() => {
    setApplied(query.trim());
    const next = {
      department: departmentFilter.trim(), jobTitle: jobFilter.trim(),
      status: statusFilter === "all" ? "" : statusFilter,
      linked: identityFilter === "all" ? "" : identityFilter,
    };
    setAppliedFilters(previous => Object.keys(next).every(key =>
      previous[key as keyof typeof previous] === next[key as keyof typeof next]) ? previous : next);
    setCursor("");
    setHistory([]);
  }, [query, departmentFilter, jobFilter, statusFilter, identityFilter]);

  useEffect(() => {
    const timer = window.setTimeout(applyFilters, 350);
    return () => window.clearTimeout(timer);
  }, [applyFilters]);

  const load = useCallback(async (overrides?: { q: string; cursor: string }) => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: overrides?.q ?? applied, cursor: overrides?.cursor ?? cursor,
        department: appliedFilters.department, jobTitle: appliedFilters.jobTitle,
        status: appliedFilters.status, linked: appliedFilters.linked,
      });
      const result = await identityFetch(`/api/hr/employees?${params.toString()}`);
      if (!result.ok) throw new Error("تعذر تحميل سجل الموظفين. تحقق من صلاحياتك أو حاول مجددًا.");
      const page: unknown = await result.json();
      if (!isEmployeePage(page)) throw new Error("تعذر قراءة سجل الموظفين: الاستجابة غير صالحة. أعد المحاولة.");
      if (revision !== loadRevision.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (revision !== loadRevision.current) return;
      setItems([]);
      setNextCursor("");
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الموظفين.");
    } finally { if (revision === loadRevision.current) setLoading(false); }
  }, [applied, cursor, appliedFilters]);

  useEffect(() => {
    const sync = () => setSelectedEmployee(new URLSearchParams(window.location.search).get("employee")?.slice(0, 160) ?? "");
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const openEmployee = (employeeId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("employee", employeeId);
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedEmployee(employeeId);
  };
  const closeEmployee = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("employee");
    url.searchParams.delete("tab");
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedEmployee("");
  };
  const selectedIndex = items.findIndex((item) => item.id === selectedEmployee);
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const moveSelection = (offset: number) => {
    const nextItem = items[selectedIndex + offset];
    if (nextItem) openEmployee(nextItem.id);
  };

  useEffect(() => { void load(); }, [load]);
  useReadOnReturn(() => load(), !loading && !saving && !formOpen);

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
      openEmployee(result.employee.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الموظف. يمكنك إعادة المحاولة دون تكرار الطلب.");
    } finally { setSaving(false); }
  }

  return <AdaptiveRecordWorkspace preferenceKey="employees" open={Boolean(selectedEmployee)} onClose={closeEmployee}
    detail={<AdaptiveRecordPanel title="ملف الموظف"
      onClose={closeEmployee} onPrevious={selectedIndex > 0 ? () => moveSelection(-1) : undefined}
      onNext={selectedIndex >= 0 && selectedIndex < items.length - 1 ? () => moveSelection(1) : undefined}>
      {selectedEmployee ? <EmployeeProfileWorkspace key={selectedEmployee} employeeId={selectedEmployee} embedded /> : null}
    </AdaptiveRecordPanel>}>
  <section className="workspace-page access-page hr-directory" aria-labelledby="hr-title">
    <PageHeader id="hr-title" title="الموارد البشرية" actions={<button type="button" className="button button-primary" onClick={() => { setFormOpen((v) => !v); setError(""); }} aria-expanded={formOpen} aria-controls={formOpen ? "employee-create" : undefined}>إضافة موظف</button>} />

    {formOpen ? <form id="employee-create" className="access-create-form" noValidate onSubmit={(event) => void save(event)}>
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
    <form className="form-actions" noValidate onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
      <label className="field-label">البحث عن موظف<input aria-label="ابحث عن موظف أو قسم" maxLength={80} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="الاسم أو القسم" /></label>
      <button type="submit" className="button button-secondary" disabled={loading}>بحث</button>
    </form>
    {pageFiltered ? <p className="access-center-scope">تُطبّق المرشحات على جميع ملفات الموظفين · {visibleItems.length} نتيجة في الصفحة الحالية.</p> : null}
    <div className="access-table-wrap" aria-busy={loading}>
      <table className="operations-table access-table">
        <caption className="visually-hidden">دليل موظفي بثواني</caption>
        <thead><tr>
          <RegistryColumnHeader label="الموظف" active={Boolean(applied)} />
          <RegistryColumnHeader label="القسم" scope="results" active={Boolean(departmentFilter)}>
            <label>القسم في جميع السجلات<input type="search" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} /></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="المسمى" scope="results" active={Boolean(jobFilter)}>
            <label>المسمى الوظيفي<input type="search" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)} /></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="النوع" scope="results" active={identityFilter !== "all"}>
            <label>ارتباط الحساب<select value={identityFilter} onChange={(event) => setIdentityFilter(event.target.value)}>
              <option value="all">جميع الموظفين</option><option value="linked">مرتبط بهوية تشغيل</option><option value="unlinked">دون هوية تشغيل</option>
            </select></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="الحالة" scope="results" active={statusFilter !== "all"}>
            <label>حالة الموظف<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">جميع الحالات</option><option value="active">نشط</option><option value="inactive">غير نشط</option>
            </select></label>
          </RegistryColumnHeader>
          <th scope="col">التفاصيل</th>
        </tr></thead>
        <tbody>{visibleItems.map((person, index) => <tr key={person.id}>
          <th scope="row">{person.fullNameAr}</th><td>{person.department}</td><td>{person.jobTitle}</td>
          <td>{person.operatorActorId ? "مرتبط بهوية تشغيل" : "بلا هوية تشغيل"}</td>
          <td className="indicator-column"><ActivityIndicator active={person.status === "active"} inactiveLabel="غير نشط" /></td>
          <td><button type="button" className="button button-quiet" aria-label={`فتح الملف: ${person.fullNameAr}`} data-adaptive-record-trigger={`employee-${index}`} onClick={() => openEmployee(person.id)}>فتح الملف</button></td>
        </tr>)}
        {!loading && !error && visibleItems.length === 0 ? <tr><td colSpan={6}>لا يوجد موظفون مطابقون للبحث أو مرشحات الصفحة.</td></tr> : null}
        {loading ? <tr><td colSpan={6}>جارٍ تحميل الموظفين…</td></tr> : null}</tbody>
      </table>
    </div>
    <ul className="employee-mobile-list" aria-label="موظفو الصفحة الحالية" aria-busy={loading}>
      {visibleItems.map((person, index) => <li className="employee-mobile-card" key={person.id}>
        <div className="employee-mobile-heading"><strong>{person.fullNameAr}</strong><ActivityIndicator active={person.status === "active"} inactiveLabel="غير نشط" /></div>
        <dl><div><dt>القسم</dt><dd>{person.department}</dd></div><div><dt>المسمى</dt><dd>{person.jobTitle}</dd></div><div><dt>الارتباط</dt><dd>{person.operatorActorId ? "هوية تشغيل مرتبطة" : "بلا هوية تشغيل"}</dd></div></dl>
        <button type="button" className="button button-secondary" aria-label={`فتح الملف: ${person.fullNameAr}`} data-adaptive-record-trigger={`employee-${index}`} onClick={() => openEmployee(person.id)}>فتح الملف</button>
      </li>)}
      {!loading && !error && visibleItems.length === 0 ? <li className="collection-state">لا يوجد موظفون مطابقون للبحث أو مرشحات الصفحة.</li> : null}
    </ul>
    <div className="form-actions">
      <ActivityLegend inactiveLabel="غير نشط" />
      <button className="button button-secondary" type="button" disabled={history.length === 0 || loading} onClick={() => { const stack = [...history]; setCursor(stack.pop() ?? ""); setHistory(stack); }}>السابق</button>
      <button className="button button-secondary" type="button" disabled={!nextCursor || loading} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>التالي</button>
    </div>
  </section>
  </AdaptiveRecordWorkspace>;
}
