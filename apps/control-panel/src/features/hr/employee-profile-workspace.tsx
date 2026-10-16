"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { HREmployee } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { RecordTabPanel, RecordTabs } from "../shared/record-tabs";
import { EmployeeAccessRequest } from "./employee-access-request";
import { EmployeeAttendance } from "./employee-attendance";
import { EmployeeAuditHistory } from "./employee-audit-history";
import { EmployeeEmploymentStatus } from "./employee-employment-status";
import { EmployeeOperatorAccess } from "./employee-operator-access";
import { EmployeePerformance } from "./employee-performance";
import { EmployeeProfileEditor } from "./employee-profile-editor";


type EmployeeTab = "overview" | "performance" | "employment" | "attendance" | "access" | "history";
const tabs: ReadonlyArray<{ key: EmployeeTab; label: string }> = [
  { key: "overview", label: "نظرة عامة" },
  { key: "performance", label: "الأداء" },
  { key: "employment", label: "البيانات الوظيفية" },
  { key: "attendance", label: "الحضور" },
  { key: "access", label: "الوصول والصلاحيات" },
  { key: "history", label: "سجل التغييرات" },
];
function dateLabel(value?: string) {
  if (!value) return "غير مسجل";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium" }).format(date);
}

export function EmployeeProfileWorkspace({ employeeId, embedded = false }: Readonly<{ employeeId: string; embedded?: boolean }>) {
  const { state } = useSession();
  const [employee, setEmployee] = useState<HREmployee | null>(null);
  const [tab, setTab] = useState<EmployeeTab>("overview");
  const [visited, setVisited] = useState<ReadonlySet<EmployeeTab>>(() => new Set(["overview"]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await identityFetch("/api/hr/employees/" + encodeURIComponent(employeeId), { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "ليست لديك صلاحية عرض سجلات الموارد البشرية." : response.status === 404 ? "ملف الموظف غير موجود." : "تعذر قراءة ملف الموظف من السجل المعتمد.");
      const result = await response.json() as { employee: HREmployee };
      if (result.employee?.id !== employeeId) throw new Error("بيانات الموظف لا تطابق الملف المطلوب.");
      setEmployee(result.employee);
    } catch (cause) {
      setEmployee(null);
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الملف.");
    } finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => {
    if (state.kind === "authenticated") void reload();
  }, [reload, state.kind]);

  function selectTab(key: string) {
    if (!tabs.some((entry) => entry.key === key)) return;
    const next = key as EmployeeTab;
    setTab(next);
    setVisited((previous) => new Set([...previous, next]));
  }

  if (state.kind !== "authenticated") return null;

  const canManageOperator = state.identity.canManageOperatorPermissions === true;
  return <div className={"bt-employee-profile-page"} dir="rtl">
    {!embedded ? <nav className={"bt-employee-profile-breadcrumb"} aria-label="مسار ملف الموظف">
      <Link href="/hr/employees">الموارد البشرية</Link><span aria-hidden="true">/</span><span>ملف الموظف</span>
    </nav> : null}
    {loading ? <p role="status" className={"bt-employee-profile-message"}>جارٍ قراءة ملف الموظف…</p> : null}
    {error ? <section className={"bt-employee-profile-message"} role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => void reload()}>إعادة المحاولة</button></section> : null}
    {employee ? <>
      <header className={"bt-employee-profile-hero"}>
        <div className={"bt-employee-profile-avatar"} aria-hidden="true">{employee.fullNameAr.trim().slice(0, 1)}</div>
        <div className={"bt-employee-profile-identity"}>
          <div className={"bt-employee-profile-heading"}>
            <h1>{employee.fullNameAr}</h1>
            <span className={employee.status === "active" ? "bt-employee-profile-active" : "bt-employee-profile-inactive"}>{employee.status === "active" ? "على رأس العمل" : "غير نشط"}</span>
            <span className={"bt-employee-profile-tag"}>{employee.operatorActorId ? "موظف ومشغّل" : "موظف"}</span>
          </div>
          <p>{employee.jobTitle} · {employee.department}</p>
          <div className={"bt-employee-profile-contact"}>
            <span>{employee.phoneE164 ? <bdi dir="ltr">{employee.phoneE164}</bdi> : "الهاتف غير مسجل"}</span>
            <span>{employee.workLocation}</span>
          </div>
        </div>
        <div className={"bt-employee-profile-heroActions"}>
          <button type="button" className="button button-secondary" onClick={() => void reload()} disabled={loading}>تحديث الملف</button>
          {employee.operatorActorId && employee.phoneE164 && canManageOperator ? <Link className="button button-primary" href={"/access/operators/" + encodeURIComponent(employee.phoneE164)}>فتح ملف المشغّل</Link> : null}
        </div>
      </header>

      <RecordTabs id="employee-file" tabs={tabs} active={tab} onSelect={selectTab} />

      <RecordTabPanel id="employee-file" tab="overview" active={tab === "overview"}>
        <section className={"bt-employee-profile-metrics"} aria-label="ملخص الموظف">
          <div><span>الحالة الوظيفية</span><strong>{employee.status === "active" ? "نشط" : "متوقف"}</strong></div>
          <div><span>وصول التشغيل</span><strong>{employee.operatorActorId ? "هوية مرتبطة" : "غير مرتبط"}</strong></div>
          <div><span>بداية العمل</span><strong>{dateLabel(employee.startDate)}</strong></div>
          <div><span>الموقع</span><strong>{employee.workLocation || "غير محدد"}</strong></div>
        </section>
        <div className={"bt-employee-profile-overviewGrid"}>
        <section className={"bt-employee-profile-panel"}>
          <div className={"bt-employee-profile-sectionHead"}><h2>ملخص البيانات الوظيفية</h2><button type="button" className="button button-secondary" onClick={() => selectTab("employment")}>إدارة البيانات</button></div>
          <dl className={"bt-employee-profile-details"}>
            <div><dt>الاسم</dt><dd>{employee.fullNameAr}</dd></div>
            <div><dt>القسم</dt><dd>{employee.department}</dd></div>
            <div><dt>المسمى</dt><dd>{employee.jobTitle}</dd></div>
            <div><dt>الهاتف</dt><dd>{employee.phoneE164 ? <bdi dir="ltr">{employee.phoneE164}</bdi> : "غير مسجل"}</dd></div>
            <div><dt>تاريخ الالتحاق</dt><dd>{dateLabel(employee.startDate)}</dd></div>
            <div><dt>مكان العمل</dt><dd>{employee.workLocation}</dd></div>
            <div><dt>المدير المباشر</dt><dd>{employee.managerEmployeeId ? <Link href={"/hr/employees/" + encodeURIComponent(employee.managerEmployeeId)}>فتح ملف المدير</Link> : "غير محدد"}</dd></div>
            <div><dt>إنشاء السجل</dt><dd>{dateLabel(employee.createdAt)}</dd></div>
          </dl>
        </section>
        <section className={"bt-employee-profile-panel"}>
          <div className={"bt-employee-profile-sectionHead"}><h2>الهوية والوصول</h2><button type="button" className="button button-secondary" onClick={() => selectTab("access")}>إدارة الوصول</button></div>
          <p className={"bt-employee-profile-helper"}>{employee.operatorActorId ? "هذا الموظف مرتبط بهوية مشغّل؛ صلاحيات التشغيل مستقلة عن حالته الوظيفية." : "لا يمتلك الموظف هوية تشغيل مرتبطة، ولا يمنح سجل الموارد البشرية أي وصول تلقائي."}</p>
          <div className={"bt-employee-profile-quickLinks"}>
            <button type="button" className="button button-secondary" onClick={() => selectTab("performance")}>مؤشرات الأداء</button>
            <button type="button" className="button button-secondary" onClick={() => selectTab("attendance")}>سجل الحضور</button>
            <button type="button" className="button button-secondary" onClick={() => selectTab("history")}>سجل القرارات</button>
          </div>
        </section>
        </div>
      </RecordTabPanel>

      <RecordTabPanel id="employee-file" tab="performance" active={tab === "performance"}>
        {visited.has("performance") ? <section className={"bt-employee-profile-panel"}><EmployeePerformance employeeId={employee.id} /></section> : null}
      </RecordTabPanel>

      <RecordTabPanel id="employee-file" tab="employment" active={tab === "employment"}>
        {visited.has("employment") ? <div className={"bt-employee-profile-columns"}>
          <section className={"bt-employee-profile-panel"}><EmployeeProfileEditor key={employee.id} employee={employee} colleagues={[]} onSaved={setEmployee} /></section>
          <section className={"bt-employee-profile-panel"}><EmployeeEmploymentStatus employee={employee} onSaved={setEmployee} /></section>
        </div> : null}
      </RecordTabPanel>

      <RecordTabPanel id="employee-file" tab="attendance" active={tab === "attendance"}>
        {visited.has("attendance") ? <section className={"bt-employee-profile-panel"}><EmployeeAttendance employeeId={employee.id} /></section> : null}
      </RecordTabPanel>

      <RecordTabPanel id="employee-file" tab="access" active={tab === "access"}>
        {visited.has("access") ? <div className={"bt-employee-profile-columns"}>
          <section className={"bt-employee-profile-panel"}>
            <div className={"bt-employee-profile-sectionHead"}><h2>طلب الوصول</h2></div>
            <EmployeeAccessRequest key={employee.id + "-request"} employee={employee} />
          </section>
          <section className={"bt-employee-profile-panel"}>
            <div className={"bt-employee-profile-sectionHead"}><h2>هوية التشغيل</h2></div>
            {employee.operatorActorId ? <p className={"bt-employee-profile-helper"}>حساب التشغيل موجود في Identity. إدارة الحساب والصلاحيات لا تمنحها الحالة الوظيفية.</p> : <p className={"bt-employee-profile-helper"}>تبدأ رحلة منح الوصول بطلب منفصل وموافقة المشغّل الأساسي.</p>}
            {employee.operatorActorId && canManageOperator ? <EmployeeOperatorAccess key={employee.id + "-operator"} employee={employee} /> : null}
            {employee.operatorActorId && employee.phoneE164 && canManageOperator ? <Link className="button button-secondary" href={"/access/operators/" + encodeURIComponent(employee.phoneE164)}>ملف الصلاحيات الكامل</Link> : null}
          </section>
        </div> : null}
      </RecordTabPanel>

      <RecordTabPanel id="employee-file" tab="history" active={tab === "history"}>
        {visited.has("history") ? <section className={"bt-employee-profile-panel"}>
          <h2>سجل القرارات والتغييرات</h2>
          <EmployeeAuditHistory key={employee.id} employee={employee} />
          <details className={"bt-employee-profile-section"}><summary><span>المعرّفات المرجعية</span><small>للدعم والتدقيق</small></summary>
            <div className={"bt-employee-profile-sectionBody"}><dl className={"bt-employee-profile-technical"}><dt>معرّف الموظف</dt><dd><bdi dir="ltr">{employee.id}</bdi></dd>
            {employee.operatorActorId ? <><dt>معرّف المشغّل</dt><dd><bdi dir="ltr">{employee.operatorActorId}</bdi></dd></> : null}
            <dt>إصدار السجل</dt><dd>{employee.version}</dd></dl></div>
          </details>
        </section> : null}
      </RecordTabPanel>
    </> : null}
  </div>;
}
