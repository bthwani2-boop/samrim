"use client";

import type { OperatorHomeAnalytics } from "@bthwani/dsh";
import Link from "next/link";


const groups = [
  { key: "delivered", label: "مُسلّمة", color: "delivered", href: "/operations?view=delivered" },
  { key: "inProgress", label: "طلبات مفتوحة أخرى", color: "inProgress", href: "/operations" },
  { key: "awaitingDispatch", label: "بانتظار الإسناد", color: "awaitingDispatch", href: "/operations?view=dispatch" },
  { key: "failed", label: "تعذّر تسليمها", color: "failed", href: "/operations?state=DELIVERY_FAILED" },
  { key: "cancelled", label: "ملغاة أو مرفوضة", color: "cancelled", href: "/operations" },
] as const;

type GroupKey = (typeof groups)[number]["key"];

export function isOperatorHomeAnalytics(value: unknown, expectedDays: 7 | 30 = 7): value is OperatorHomeAnalytics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  if (report.timeZone !== "Asia/Aden" || typeof report.measuredAt !== "string" || !Number.isFinite(Date.parse(report.measuredAt))
    || !Array.isArray(report.days) || report.days.length !== expectedDays) return false;
  const keys = ["orders", "delivered", "inProgress", "awaitingDispatch", "failed", "cancelled"];
  let previous = "";
  return report.days.every((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const day = raw as Record<string, unknown>;
    if (typeof day.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)
      || day.day <= previous || !Number.isFinite(Date.parse(day.day + "T00:00:00Z"))) return false;
    previous = day.day;
    if (!keys.every((key) => Number.isSafeInteger(day[key]) && Number(day[key]) >= 0)) return false;
    return Number(day.orders) === keys.slice(1).reduce((sum, key) => sum + Number(day[key]), 0);
  });
}

const fmt = (value: number) => value.toLocaleString("ar-YE");
function dayLabel(isoDay: string) {
  return new Intl.DateTimeFormat("ar-YE", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(isoDay + "T12:00:00Z"));
}

export function OperatorHomeCharts({ report, error, loading = false }: Readonly<{ report: OperatorHomeAnalytics | null; error: string | undefined; loading?: boolean }>) {
  const days = report?.days ?? [];
  const total = days.reduce((sum, day) => sum + day.orders, 0);
  const today = days.at(-1)?.orders ?? 0;
  const max = Math.max(...days.map((day) => day.orders), 1);
  const plot = { x: 48, y: 22, width: 622, height: 166 };
  const y = (count: number) => plot.y + plot.height - (count / max) * plot.height;
  const x = (index: number) => plot.x + (index * plot.width) / 6;
  const points = days.map((day, index) => [x(index), y(day.orders)] as const);
  const linePath = points.map(([px, py], index) => (index === 0 ? "M" : "L") + px.toFixed(2) + "," + py.toFixed(2)).join(" ");
  const areaPath = points.length ? linePath + " L" + x(6) + "," + (plot.y + plot.height) + " L" + plot.x + "," + (plot.y + plot.height) + " Z" : "";
  const aggregates = groups.map((group) => ({
    ...group, count: days.reduce((sum, day) => sum + day[group.key as GroupKey], 0),
  }));
  let running = 0;
  const segments = aggregates.map((group) => {
    const start = running;
    const width = total ? (group.count / total) * 1000 : 0;
    running += width;
    return { ...group, start, width };
  });

  return <section className={"bt-home-chart-section"} aria-labelledby="home-analytics-title">
    <div className={"bt-home-chart-heading"}>
      <div>
        <p className={"bt-home-chart-overline"}>تحليلات التشغيل</p>
        <h2 id="home-analytics-title">حركة الطلبات خلال آخر 7 أيام</h2>
        <p>بالتوقيت المحلي لليمن؛ يوم الإنشاء يشمل اليوم الجاري حتى وقت القياس.</p>
      </div>
      <Link href="/operations" className={"bt-home-chart-link"}>استعراض الطلبات ←</Link>
    </div>
    {error ? <div className={"bt-home-chart-unavailable"} role="alert">تعذرت قراءة التحليلات: {error}</div>
      : loading && !report ? <div className={"bt-home-chart-unavailable"} role="status">جارٍ قراءة التحليلات…</div>
      : !report ? <div className={"bt-home-chart-unavailable"} role="status">بيانات التحليلات غير متاحة حاليًا؛ لا تُعرض رسوم أو أرقام تقديرية.</div>
      : <div className={"bt-home-chart-grid"}>
        <div className={"bt-home-chart-chartArea"}>
          <div className={"bt-home-chart-chartHeading"}><div><span>الطلبات المنشأة يوميًا</span><strong>{fmt(total)} <small>طلب خلال الفترة</small></strong></div><span className={"bt-home-chart-today"}>اليوم: <strong>{fmt(today)}</strong></span></div>
          <svg className={"bt-home-chart-lineChart"} viewBox="0 0 720 198" role="img" aria-label={"رسم لاتجاه الطلبات المنشأة خلال سبعة أيام، الإجمالي " + fmt(total)}>
            <defs><linearGradient id="operatorHomeOrdersFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" className={"bt-home-chart-fillStart"} /><stop offset="100%" className={"bt-home-chart-fillEnd"} /></linearGradient></defs>
            {[0, 0.5, 1].map((level) => <g key={level}><line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height * level} y2={plot.y + plot.height * level} className={"bt-home-chart-gridline"} /><text x={plot.x - 10} y={plot.y + plot.height * level + 4} textAnchor="end" className={"bt-home-chart-axisText"}>{fmt(Math.round(max * (1 - level)))}</text></g>)}
            {points.length === 7 ? <><path d={areaPath} className={"bt-home-chart-areaFill"} /><path d={linePath} className={"bt-home-chart-chartLine"} /></> : null}
            {points.map(([px, py], index) => <g key={days[index]?.day}>
              <circle cx={px} cy={py} r="4.5" className={"bt-home-chart-chartDot"}>
                <title>{dayLabel(days[index]!.day)}: {fmt(days[index]!.orders)} طلب</title>
              </circle>
            </g>)}
          </svg>
          <section className={"bt-home-chart-dayList"} aria-label="القيم اليومية">
            {days.map((day) => <span key={day.day}><time dateTime={day.day}>{dayLabel(day.day)}</time><strong>{fmt(day.orders)}</strong></span>)}
          </section>
        </div>
        <div className={"bt-home-chart-breakdown"}>
          <div className={"bt-home-chart-chartHeading"}><div><span>حالة طلبات الفترة حاليًا</span><strong>{fmt(total)} <small>طلب</small></strong></div></div>
          {total === 0 ? <div className={"bt-home-chart-emptyBar"}>لم تُنشأ طلبات خلال الفترة.</div>
            : <svg viewBox="0 0 1000 28" preserveAspectRatio="none" className={"bt-home-chart-stackedChart"} role="img" aria-label="توزيع حالات طلبات الأيام السبعة">
              {segments.map((part) => part.width > 0 ? <rect key={part.key} x={part.start} y={0} width={part.width} height={28} className={("bt-home-chart-" + (part.color))}><title>{part.label}: {fmt(part.count)}</title></rect> : null)}
            </svg>}
          <ul className={"bt-home-chart-legend"}>{aggregates.map((group) => <li key={group.key}>
            <Link href={group.href}><span className={("bt-home-chart-" + (group.color + "Dot"))} aria-hidden="true" /><span>{group.label}</span><strong>{fmt(group.count)}</strong><small>{total ? fmt(Math.round((group.count / total) * 100)) + "٪" : "—"}</small></Link>
          </li>)}</ul>
          <p className={"bt-home-chart-methodology"}>الحالات الحالية للطلبات المنشأة خلال الأيام السبعة، وليست حالات كل يوم وقت انتهائه. لا تعني نسبة المكتمل تقييم سرعة التسليم.</p>
        </div>
      </div>}
    {report ? <p className={"bt-home-chart-updated"}><span>آخر قياس</span> <time dateTime={report.measuredAt}>{new Date(report.measuredAt).toLocaleString("ar-YE", { timeZone: "Asia/Aden", dateStyle: "short", timeStyle: "short" })}</time></p> : null}
  </section>;
}
