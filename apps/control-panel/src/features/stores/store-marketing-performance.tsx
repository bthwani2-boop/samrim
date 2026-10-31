"use client";

import type { StoreContentPerformanceSummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function StoreMarketingPerformance({ storeId }: Readonly<{ storeId: string }>) {
  const [period, setPeriod] = useState<"7d" | "30d" | "all">("all");
  const [summary, setSummary] = useState<StoreContentPerformanceSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    void retry;
    const controller = new AbortController();
    setSummary(null); setError(""); setLoading(true);
    void fetch("/api/stores/" + encodeURIComponent(storeId) + "/marketing/summary?period=" + period,
      { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "MARKETING_FORBIDDEN" : "MARKETING_READ_FAILED");
        return await response.json() as StoreContentPerformanceSummary;
      })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!result || result.storeId !== storeId || result.period !== period ||
          [result.contentCount, result.impressions, result.clicks, result.attributedOrdersCreated, result.attributedOrdersCompleted]
            .some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("STORE_MARKETING_SCOPE_MISMATCH");
        setSummary(result);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === "MARKETING_FORBIDDEN"
          ? "قراءة التحليلات تتطلب صلاحية التسويق لدى المشغّل."
          : "تعذرت قراءة تحليلات مقاطع المتجر. تحقق من الاتصال والصلاحية ثم أعد المحاولة.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, period, retry]);

  const visibleSummary = summary?.storeId === storeId && summary.period === period ? summary : null;
  return <section aria-label="إحصاءات مقاطع هذا المتجر">
    <p className="store-profile-muted">أحداث DSH المسجلة لمقاطع المتجر في الفترة المختارة؛ «المقاطع» تعني المنشأة خلالها. النقر والظهور ليسا مستخدمين فريدين.</p>
    <div className="store-product-actions">
      {([{value:"7d",label:"7 أيام"},{value:"30d",label:"30 يومًا"},{value:"all",label:"كل الفترات"}] as const).map(item =>
        <button key={item.value} type="button" className={"button "+(period===item.value?"button-primary":"button-secondary")}
          aria-pressed={period===item.value} onClick={()=>setPeriod(item.value)}>{item.label}</button>)}
    </div>
    {loading ? <p role="status">جارٍ قراءة تحليلات المقاطع…</p> : null}
    {error ? <p role="alert">{error} <button type="button" className="button button-secondary"
      onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></p> : null}
    {!loading && !error && visibleSummary ? <dl className="store-profile-facts">
      {[
        { label: "مقاطع المتجر", value: visibleSummary.contentCount },
        { label: "أحداث الظهور", value: visibleSummary.impressions },
        { label: "النقرات", value: visibleSummary.clicks },
        { label: "طلبات منشأة منسوبة", value: visibleSummary.attributedOrdersCreated },
        { label: "طلبات مكتملة منسوبة", value: visibleSummary.attributedOrdersCompleted },
      ].map(item => <div key={item.label}><dt>{item.label}</dt>
        <dd>{item.value.toLocaleString("ar-YE")}</dd></div>)}
    </dl> : null}
    <p className="store-profile-muted">الطلب المكتمل المنسوب يعني حالة تسليم أو استلام حاليًا بعد نقرة مؤهلة؛ لا يثبت تحصيلًا أو تسوية WLT.</p>
  </section>;
}
