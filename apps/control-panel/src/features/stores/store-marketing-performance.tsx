"use client";

import type { StoreContentPerformanceSummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function StoreMarketingPerformance({ storeId }: Readonly<{ storeId: string }>) {
  const [summary, setSummary] = useState<StoreContentPerformanceSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    void retry;
    const controller = new AbortController();
    setSummary(null); setError(""); setLoading(true);
    void fetch("/api/stores/" + encodeURIComponent(storeId) + "/marketing/summary",
      { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "MARKETING_FORBIDDEN" : "MARKETING_READ_FAILED");
        return await response.json() as StoreContentPerformanceSummary;
      })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!result || result.storeId !== storeId ||
          [result.contentCount, result.impressions, result.clicks, result.attributedOrdersCreated]
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
  }, [storeId, retry]);

  const visibleSummary = summary?.storeId === storeId ? summary : null;
  return <section aria-label="إحصاءات مقاطع هذا المتجر">
    <p className="store-profile-muted">أحداث DSH المسجلة لمقاطع المتجر، بما فيها التاريخية. النقر والظهور ليسا مستخدمين فريدين.</p>
    {loading ? <p role="status">جارٍ قراءة تحليلات المقاطع…</p> : null}
    {error ? <p role="alert">{error} <button type="button" className="button button-secondary"
      onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></p> : null}
    {!loading && !error && visibleSummary ? <dl className="store-profile-facts">
      {[
        { label: "مقاطع المتجر", value: visibleSummary.contentCount },
        { label: "أحداث الظهور", value: visibleSummary.impressions },
        { label: "النقرات", value: visibleSummary.clicks },
        { label: "طلبات منشأة منسوبة", value: visibleSummary.attributedOrdersCreated },
      ].map(item => <div key={item.label}><dt>{item.label}</dt>
        <dd>{item.value.toLocaleString("ar-YE")}</dd></div>)}
    </dl> : null}
    <p className="store-profile-muted">الطلب المنشأ المنسوب ليس طلبًا مكتملًا أو إيرادًا. تبقى المبالغ لدى WLT.</p>
  </section>;
}
