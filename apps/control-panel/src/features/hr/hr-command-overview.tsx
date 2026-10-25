"use client";

import { useEffect, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { CommandBarPanel, CommandMetricStrip } from "../shared/command-surface";
import type { HRSummary } from "../../server/dsh/dsh-bff";

function validSummary(value: unknown): value is HRSummary {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  return count(data.total) && count(data.active) && count(data.inactive) && count(data.linked)
    && Number(data.active) + Number(data.inactive) === data.total && Number(data.linked) <= Number(data.total)
    && Array.isArray(data.departments) && data.departments.every((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return typeof item.name === "string" && count(item.count);
    });
}

export function HRCommandOverview({ onRegistry }: Readonly<{onEmployee:(id:string)=>void;onRegistry:()=>void}>) {
  const [summary, setSummary] = useState<HRSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    void revision; // Retry key: changing it intentionally re-runs this request.
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void identityFetch("/api/hr/summary", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error("تعذرت قراءة إجماليات الموظفين.");
        const data: unknown = await response.json();
        if (!validSummary(data)) throw Error("استجابة مؤشرات الموارد البشرية غير صالحة.");
        if (!controller.signal.aborted) setSummary(data);
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setSummary(null);
          setError(cause instanceof Error ? cause.message : "الموارد البشرية غير متاحة.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  return <div className="bt-command-coverage" data-testid="hr-command" aria-busy={loading}>
    <CommandMetricStrip metrics={[
      { id: "employees", label: "إجمالي الموظفين", value: summary?.total ?? null, description: "جميع ملفات الشركة" },
      { id: "active", label: "نشطون", value: summary?.active ?? null, description: "جميع الموظفين", tone: "success" },
      { id: "inactive", label: "غير نشطين", value: summary?.inactive ?? null, description: "جميع الموظفين", tone: "warning" },
      { id: "linked", label: "مرتبطون بحساب مشغّل", value: summary?.linked ?? null, description: "الارتباط ليس شرطًا للتوظيف" },
    ]}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="توزيع الموظفين حسب الإدارة" subtitle="أكبر الإدارات من إجمالي الشركة" total={summary?.total ?? 0}
        measures={summary?.departments.map(row => ({ id: row.name, label: row.name, value: row.count })) ?? []} />
      <CommandBarPanel title="الحالة الوظيفية" subtitle="جميع موظفي الشركة" total={summary?.total ?? 0}
        measures={summary ? [
          { id: "active", label: "نشط", value: summary.active, tone: "success" as const },
          { id: "inactive", label: "غير نشط", value: summary.inactive, tone: "warning" as const },
        ] : []}/>
    </div>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onRegistry}>فتح سجل الموظفين</button></div>
    {loading ? <p role="status" className="bt-command-footnote">جارٍ قراءة إجماليات الموارد البشرية…</p>
      : error ? <div role="alert" className="access-card"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => setRevision(n => n + 1)}>إعادة المحاولة</button></div>
      : <p className="bt-command-footnote">الأرقام محسوبة من جميع ملفات الموظفين، وليست من صفحة السجل. عدم وجود حساب مشغّل ليس مخالفة.</p>}
  </div>;
}
