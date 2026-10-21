"use client";

import { useCallback, useEffect, useState } from "react";
import type { HRAttendancePage, HRAttendanceRecord } from "../../server/dsh/dsh-bff";
import { identityFetch } from "../../session/identity-fetch";
import { RegistryColumnHeader } from "../shared/registry-column-header";


function localDay(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function last30Days() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 29);
  return { from: localDay(start), to: localDay(today) };
}

const statusLabels = {
  present: "حضور مسجل",
  late: "تأخر مسجل",
  absent: "غياب مسجل",
  leave: "إجازة مسجلة",
} as const;

export function EmployeePerformance({ employeeId }: Readonly<{ employeeId: string }>) {
  const [items, setItems] = useState<readonly HRAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter,setStatusFilter]=useState("all");
  const [dateOrder,setDateOrder]=useState("desc");
  const period = last30Days();
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const range = last30Days();
      const qs = new URLSearchParams(range);
      const response = await identityFetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/attendance?${qs}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "ليست لديك صلاحية الاطلاع على سجل الحضور." : "تعذرت قراءة سجلات الحضور.");
      const data = await response.json() as HRAttendancePage;
      if (!Array.isArray(data.items) || data.items.some((entry) => entry.employeeId !== employeeId)) throw new Error("بيانات الحضور غير متطابقة.");
      setItems(data.items);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة المؤشرات.");
    } finally { setLoading(false); }
  }, [employeeId]);
  useEffect(() => { void load(); }, [load]);

  const visibleRecords=items.filter((item)=>statusFilter==="all"||item.status===statusFilter)
    .sort((a,b)=>(dateOrder==="asc"?1:-1)*a.date.localeCompare(b.date));
  const counts = {
    recorded: items.length,
    present: items.filter((item) => item.status === "present").length,
    late: items.filter((item) => item.status === "late").length,
    absent: items.filter((item) => item.status === "absent").length,
    leave: items.filter((item) => item.status === "leave").length,
  };

  return <section className={"bt-employee-performance-performance"} aria-labelledby="attendance-performance-title">
    <header className={"bt-employee-performance-heading"}>
      <div><h2 id="attendance-performance-title">مؤشرات الالتزام المسجلة</h2><p>آخر 30 يومًا: {period.from} إلى {period.to}</p></div>
      <button className="button button-secondary" type="button" disabled={loading} onClick={() => void load()}>تحديث المؤشرات</button>
    </header>
    <p className={"bt-employee-performance-method"}>هذه مؤشرات وصفية للتسجيلات اليدوية المعتمدة في الموارد البشرية، وليست تقييمًا لإنتاجية الموظف أو نسبة حضوره الفعلية. اليوم غير المسجل لا يُعد غيابًا.</p>
    {loading ? <p role="status">جارٍ حساب المؤشرات من سجل الحضور…</p> : null}
    {error ? <div role="alert" className={"bt-employee-performance-error"}>{error} <button className="button button-secondary" type="button" onClick={() => void load()}>إعادة المحاولة</button></div> : null}
    {!loading && !error ? <>
      <section className={"bt-employee-performance-metrics"} aria-label="المؤشرات المسجلة">
        {([
          ["recorded", "أيام لها تسجيل"],
          ["present", "حضور"],
          ["late", "تأخر"],
          ["absent", "غياب"],
          ["leave", "إجازة"],
        ] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{counts[key].toLocaleString("ar-YE-u-nu-latn")}</strong></div>)}
      </section>
      {items.length ? <section className={"bt-employee-performance-distribution"} aria-label="توزيع حالات الأيام الموثقة">
        <h3>توزيع الحالات المسجلة</h3>
        <p>النسب من الأيام التي لها تسجيل فقط ({counts.recorded} يومًا)، وليست من أيام العمل المفترضة.</p>
        {(["present", "late", "absent", "leave"] as const).map((key) => <div className={"bt-employee-performance-distributionRow"} key={key}>
          <span>{statusLabels[key]}</span>
          <progress max={counts.recorded} value={counts[key]} aria-label={statusLabels[key]} />
          <strong>{counts[key]} / {counts.recorded}</strong>
        </div>)}
      </section> : null}
      {items.length ? <div className={"bt-employee-performance-records"}>
        <h3>تفاصيل الأيام المسجلة</h3>
        <table><thead><tr>
          <RegistryColumnHeader label="اليوم" scope="page" active={dateOrder!=="desc"}>
            <label>ترتيب الأيام<select value={dateOrder} onChange={e=>setDateOrder(e.target.value)}>
              <option value="desc">الأحدث أولًا</option><option value="asc">الأقدم أولًا</option>
            </select></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="التسجيل" scope="page" active={statusFilter!=="all"}>
            <label>حالة التسجيل<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
              <option value="all">الجميع</option>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
            </select></label>
          </RegistryColumnHeader>
          <th scope="col">آخر توثيق</th>
        </tr></thead>
          <tbody>{visibleRecords.map((entry) => <tr key={entry.date}>
            <td><time dateTime={entry.date}>{entry.date}</time></td><td>{statusLabels[entry.status]}</td><td>{entry.recordedAt ? new Intl.DateTimeFormat("ar-YE-u-nu-latn", { dateStyle: "medium" }).format(new Date(entry.recordedAt)) : "غير متاح"}</td>
          </tr>)}{visibleRecords.length===0?<tr><td colSpan={3}>لا توجد تسجيلات مطابقة في هذه الفترة.</td></tr>:null}</tbody>
        </table>
      </div> : <p className={"bt-employee-performance-empty"}>لا توجد تسجيلات موثقة في هذه الفترة. لا يمكن استنتاج الانضباط أو الغياب.</p>}
    </> : null}
    <aside className={"bt-employee-performance-limit"}>
      <strong>قياس الأداء التشغيلي</strong>
      <p>عدد المهام المُنجزة، زمن المعالجة، جودة القرارات وتصحيح الأخطاء تحتاج أحداثًا تشغيلية منسوبة للمشغّل ومراجَعة الصلاحية قبل عرضها. لا تُحسب من تسجيل الدخول أو الحضور.</p>
    </aside>
  </section>;
}
