"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccountAccessPanel, type ManagedOperatorStatus } from "../../../../../src/features/access/account-access-panel";
import { EmployeePerformance } from "../../../../../src/features/hr/employee-performance";
import { Tabs } from "antd";
import type { HREmployee } from "../../../../../src/server/dsh/dsh-bff";
import { identityFetch } from "../../../../../src/session/identity-fetch";
import { useSession } from "../../../../../src/session/session-provider";


type OperatorTab = "overview" | "performance" | "permissions" | "employment";
const tabs: ReadonlyArray<{ key: OperatorTab; label: string }> = [
  { key: "overview", label: "نظرة عامة" },
  { key: "performance", label: "الأداء" },
  { key: "permissions", label: "الصلاحيات والتحكم" },
  { key: "employment", label: "الملف الوظيفي" },
];
function formatDate(value?: string) {
  if (!value) return "غير متاح";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير متاح" : new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function OperatorProfilePage() {
  const { state } = useSession();
  const { operatorPhone } = useParams<{ operatorPhone: string }>();
  const router = useRouter();
  const phone = (() => { try { return decodeURIComponent(operatorPhone); } catch { return ""; } })();
  const [actorId, setActorId] = useState<string | null>(null);
  const [status, setStatus] = useState<ManagedOperatorStatus | null>(null);
  const [employee, setEmployee] = useState<HREmployee | null>(null);
  const [tab, setTab] = useState<OperatorTab>("overview");
  const [performanceOpened, setPerformanceOpened] = useState(false);
  const [linkState, setLinkState] = useState<"loading" | "found" | "not-found" | "failed">("loading");
  const resolveActor = useCallback((id: string | null) => setActorId(id), []);
  const resolveStatus = useCallback((next: ManagedOperatorStatus | null) => setStatus(next), []);

  const canManage = state.kind === "authenticated" && state.identity.canManageOperatorPermissions === true;
  const canReadHR = state.kind === "authenticated" && state.identity.permissions?.includes("hr");

  useEffect(() => {
    if (!actorId || !canReadHR) {
      setEmployee(null);
      setLinkState("not-found");
      return;
    }
    let live = true;
    setEmployee(null);
    setLinkState("loading");
    void (async () => {
      try {
        const response = await identityFetch("/api/hr/operator-employees/" + encodeURIComponent(actorId), { cache: "no-store" });
        if (response.status === 404) {
          if (live) setLinkState("not-found");
          return;
        }
        if (!response.ok) throw new Error("تعذر قراءة الارتباط الوظيفي.");
        const payload = await response.json() as { employee: HREmployee };
        if (payload.employee.operatorActorId !== actorId) throw new Error("الارتباط غير متطابق.");
        if (live) { setEmployee(payload.employee); setLinkState("found"); }
      } catch {
        if (live) setLinkState("failed");
      }
    })();
    return () => { live = false; };
  }, [actorId, canReadHR]);

  function selectTab(key: string) {
    if (!tabs.some((entry) => entry.key === key)) return;
    const next = key as OperatorTab;
    setTab(next);
    if (next === "performance") setPerformanceOpened(true);
  }

  if (state.kind !== "authenticated") return null;
  if (!canManage) return <div className={"bt-operator-profile-page"}><p role="alert">إدارة ملفات المشغّلين متاحة للمشغّل الأساسي المخوّل فقط.</p><Link href="/access">العودة إلى الوصول والصلاحيات</Link></div>;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return <div className={"bt-operator-profile-page"}><p role="alert">رقم المشغّل غير صالح.</p><Link href="/access?view=permissions">العودة إلى حسابات المشغّلين</Link></div>;

  return <div className={"bt-operator-profile-page"} dir="rtl">
    <nav className={"bt-operator-profile-breadcrumb"} aria-label="مسار ملف المشغّل">
      <Link href="/access?view=permissions">الوصول والصلاحيات</Link><span aria-hidden="true">/</span><span>ملف المشغّل</span>
    </nav>
    <header className={"bt-operator-profile-hero"}>
      <div className={"bt-operator-profile-avatar"} aria-hidden="true">{status?.fullNameAr?.slice(0, 1) || "م"}</div>
      <div className={"bt-operator-profile-heading"}>
        <h1>{status?.fullNameAr || "ملف المشغّل"}</h1>
        <p>{[status?.jobTitle, status?.department].filter(Boolean).join(" · ") || "هوية التشغيل والصلاحيات"}</p>
        <bdi dir="ltr">{phone}</bdi>
      </div>
      <Link href="/access?view=permissions" className="button button-secondary">العودة إلى الحسابات</Link>
    </header>

    <Tabs aria-label="أقسام الملف" activeKey={tab} onChange={selectTab} destroyOnHidden={false} items={[

    { key: "overview", label: tabs[0]!.label, children: (<>
      <section className={"bt-operator-profile-metrics"} aria-label="مؤشرات هوية المشغّل">
        <div><span>حالة الحساب</span><strong>{status ? !status.securityEnabled ? "الهوية موقوفة" : !status.enabled ? "الدور موقوف" : !status.activated ? "بانتظار التفعيل" : "نشط" : "جارٍ التحقق"}</strong></div>
        <div><span>آخر دخول موثّق</span><strong>{formatDate(status?.lastAuthenticatedAt)}</strong></div>
        <div><span>تفعيل الحساب</span><strong>{formatDate(status?.activatedAt)}</strong></div>
        <div><span>الارتباط الوظيفي</span><strong>{employee ? "مرتبط" : linkState === "loading" ? "جارٍ التحقق" : linkState === "failed" ? "غير متاح" : "لا يوجد ارتباط"}</strong></div>
      </section>
      <div className={"bt-operator-profile-grid"}>
        <section className={"bt-operator-profile-section"}>
          <div className={"bt-operator-profile-sectionHeader"}><h2>الهوية والوصول</h2><span>بيانات Identity المعتمدة</span></div>
          <dl className={"bt-operator-profile-details"}>
            <div><dt>المشغّل</dt><dd>{status?.fullNameAr || "لم تُقرأ الهوية"}</dd></div>
            <div><dt>القسم</dt><dd>{status?.department || "غير محدد"}</dd></div>
            <div><dt>المسمى</dt><dd>{status?.jobTitle || "غير محدد"}</dd></div>
            <div><dt>حالة الهوية</dt><dd>{status ? status.securityEnabled ? "مفعّلة" : "موقوفة" : "جارٍ التحقق"}</dd></div>
            <div><dt>حالة دور المشغّل</dt><dd>{status ? status.enabled ? "مفعّل" : "موقوف" : "جارٍ التحقق"}</dd></div>
            <div><dt>تاريخ إنشاء الحساب</dt><dd>{formatDate(status?.createdAt)}</dd></div>
          </dl>
        </section>
        <section className={"bt-operator-profile-section"}>
          <div className={"bt-operator-profile-sectionHeader"}><h2>الارتباط الوظيفي</h2><span>سجل الموارد البشرية</span></div>
          {employee ? <p className={"bt-operator-profile-description"}>{employee.fullNameAr} · {employee.jobTitle} · {employee.department}</p>
            : <p className={"bt-operator-profile-description"}>{!canReadHR ? "لا تملك صلاحية قراءة الموارد البشرية." : linkState === "failed" ? "تعذر قراءة السجل الوظيفي." : linkState === "loading" ? "جارٍ فحص الارتباط…" : "لا يوجد سجل وظيفي مرتبط بالهوية."}</p>}
          <nav className={"bt-operator-profile-actionDeck"} aria-label="إجراءات المشغّل">
            <button className={"bt-operator-profile-actionLink"} type="button" onClick={() => selectTab("permissions")}>
              <strong>إدارة الصلاحيات والحساب</strong><span>المراجعة، المنح، السحب وتعطيل الحساب</span>
            </button>
            <button className={"bt-operator-profile-actionLink"} type="button" onClick={() => selectTab("performance")}>
              <strong>مؤشرات الأداء</strong><span>المؤشرات المسجلة ومصادرها وحدودها</span>
            </button>
            {canReadHR && employee ? <Link className={"bt-operator-profile-actionLink"} href={"/hr/employees/" + encodeURIComponent(employee.id)}>
              <strong>فتح ملف الموظف</strong><span>الحضور والبيانات والقرارات الوظيفية</span>
            </Link> : null}
          </nav>
        </section>
      </div>
    </>) },

    { key: "performance", label: tabs[1]!.label, children: (<>
      <section className={"bt-operator-profile-section"}>
        <div className={"bt-operator-profile-sectionHeader"}><h2>الأداء التشغيلي</h2><span>مصادر القياس</span></div>
        <p className={"bt-operator-profile-description"}>لا تتوفر حتى الآن بيانات منسوبة للمشغّل بشكل موثق لقياس الطلبات التي عالجها، أو زمن الاستجابة، أو جودة قراراته. لذلك لن تُعرض نسب نجاح أو درجات أداء مصطنعة. آخر تسجيل دخول ليس مؤشر إنتاجية.</p>
        <dl className={"bt-operator-profile-details"}>
          <div><dt>آخر تسجيل دخول موثّق في الهوية</dt><dd>{formatDate(status?.lastAuthenticatedAt)}</dd></div>
          <div><dt>تاريخ التفعيل</dt><dd>{formatDate(status?.activatedAt)}</dd></div>
        </dl>
      </section>
      {canReadHR && employee && performanceOpened ? <section className={"bt-operator-profile-section"}>
        <EmployeePerformance employeeId={employee.id} />
      </section> : canReadHR && linkState === "loading" ? <p role="status">جارٍ التحقق من ارتباط الحضور الوظيفي…</p> : null}
    </>) },

    { key: "permissions", label: tabs[2]!.label, forceRender: true, children: (<>
      <p className={"bt-operator-profile-description"}>التغييرات هنا تُقرأ وتُحفظ عبر Identity، مع إصدار الحالة وسبب القرار ومنع تعديل الصلاحيات الذاتية.</p>
      <div className={"bt-operator-profile-controls"}><AccountAccessPanel key={phone} embedded selectedPhone={phone} onActorResolved={resolveActor} onStatusResolved={resolveStatus} onClear={() => router.push("/access?view=permissions")} /></div>
    </>) },

    { key: "employment", label: tabs[3]!.label, children: (<>
      <section className={"bt-operator-profile-section"}>
        <div className={"bt-operator-profile-sectionHeader"}><h2>السجل الوظيفي</h2><span>الموارد البشرية</span></div>
        {!canReadHR ? <p className={"bt-operator-profile-description"}>لا تملك صلاحية قراءة ملفات الموظفين؛ لا تُعرض بياناتهم من هوية التشغيل.</p> :
          employee ? <>
            <dl className={"bt-operator-profile-details"}>
              <div><dt>الموظف</dt><dd>{employee.fullNameAr}</dd></div>
              <div><dt>القسم</dt><dd>{employee.department}</dd></div>
              <div><dt>الوظيفة</dt><dd>{employee.jobTitle}</dd></div>
              <div><dt>الحالة الوظيفية</dt><dd>{employee.status === "active" ? "على رأس العمل" : "غير نشط"}</dd></div>
              <div><dt>تاريخ البداية</dt><dd>{employee.startDate}</dd></div>
              <div><dt>موقع العمل</dt><dd>{employee.workLocation}</dd></div>
            </dl>
            <Link className="button button-secondary" href={"/hr/employees/" + encodeURIComponent(employee.id)}>فتح ملف الموظف</Link>
          </> : <p className={"bt-operator-profile-description"}>{linkState === "loading" ? "جارٍ قراءة سجل الموارد البشرية…" : linkState === "failed" ? "تعذر التحقق من الارتباط، أعد فتح الملف للمحاولة." : "لا يوجد سجل موظف مرتبط بهذا المشغّل."}</p>}
      </section>
    </>) },

      ]} />
  </div>;
}
