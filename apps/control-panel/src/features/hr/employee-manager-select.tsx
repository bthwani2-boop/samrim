"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HREmployee, HREmployeePage } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";

type Props = Readonly<{
  value: string;
  initial: readonly HREmployee[];
  excludeId?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}>;

// Search the complete HR directory on the server; the first page is only a shortcut.
export function EmployeeManagerSelect({ value, initial, excludeId = "", onChange, disabled = false }: Props) {
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<readonly HREmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const [error, setError] = useState("");
  const revision = useRef(0);

  const people = useMemo(() => {
    const byId = new Map<string, HREmployee>();
    for (const employee of [...initial, ...matches]) {
      if (employee.status === "active" && employee.id !== excludeId) byId.set(employee.id, employee);
    }
    return [...byId.values()];
  }, [initial, matches, excludeId]);
  const hasSelected = people.some(employee => employee.id === value);

  const load = useCallback(async (term: string, cursor = "", requestRevision = revision.current) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: term, cursor, limit: "50", status: "active" });
      const response = await identityFetch(`/api/hr/employees?${params}`);
      if (!response.ok) throw new Error("تعذر البحث عن المسؤول المباشر.");
      const page: HREmployeePage = await response.json();
      if (!Array.isArray(page.items) || page.items.some(person => typeof person.id !== "string"))
        throw new Error("نتائج الموظفين غير صالحة.");
      if (requestRevision !== revision.current) return;
      setMatches(previous => cursor ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (requestRevision !== revision.current) return;
      setError(cause instanceof Error ? cause.message : "تعذر البحث عن المسؤول.");
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestRevision = ++revision.current;
    const term = search.trim();
    if (term.length < 2) {
      setMatches([]);
      setNextCursor("");
      setError("");
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => { void load(term, "", requestRevision); }, 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  return <div className="form-section form-section--w400">
    <label className="field-label">ابحث عن المسؤول المباشر
      <input type="search" value={search} maxLength={80} disabled={disabled}
        autoComplete="off" onChange={event => setSearch(event.target.value)}
        placeholder="اكتب حرفين من الاسم أو القسم" />
    </label>
    <label className="field-label">المسؤول المباشر (اختياري)
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">غير محدد</option>
        {value && !hasSelected ? <option value={value}>المسؤول الحالي — خارج النتائج المعروضة</option> : null}
        {people.map(employee => <option key={employee.id} value={employee.id}>{employee.fullNameAr} · {employee.department}</option>)}
      </select>
    </label>
    {loading ? <p role="status">جارٍ البحث في جميع الموظفين…</p> : null}
    {nextCursor ? <button type="button" className="button button-quiet" disabled={disabled || loading}
      onClick={() => void load(search.trim(), nextCursor)}>عرض المزيد</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
