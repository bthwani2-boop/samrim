"use client";

import type { OperatorMarketingSummary } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";

export function MarketingOverviewSummary() {
  const [summary, setSummary] = useState<OperatorMarketingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/marketing/summary?retry=" + revision, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذرت قراءة الإجماليات من DSH.");
        const value = await response.json() as OperatorMarketingSummary;
        const counts = [value.activePromotions, value.scheduledPromotions, value.endedPromotions, value.draftPromotions, value.pausedPromotions, value.activeContent];
        if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0) || !value.asOf) throw new Error("استجابة إجماليات التسويق غير صالحة.");
        if (!controller.signal.aborted) setSummary(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) { setSummary(null); setError("تعذرت قراءة إجماليات التسويق، ولا يمكن اعتبارها صفرًا."); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  if (loading) return <p role="status">جارٍ قراءة إجماليات التسويق...</p>;
  if (error || !summary) return <div role="alert" className="access-card">
    <p>{error || "إجماليات التسويق غير متاحة."}</p>
    <button className="button button-secondary" type="button" onClick={() => setRevision((current) => current + 1)}>إعادة المحاولة</button>
  </div>;
  const counts = [
    { name: "العروض الفعالة", value: summary.activePromotions },
    { name: "العروض المجدولة", value: summary.scheduledPromotions },
    { name: "العروض المنتهية", value: summary.endedPromotions },
    { name: "المسودات", value: summary.draftPromotions },
    { name: "العروض المتوقفة", value: summary.pausedPromotions },
    { name: "المحتوى المنشور الساري", value: summary.activeContent },
  ];
  const activeCounts = counts.filter(({ value }) => value > 0);
  return <section className="marketing-overview-compact" aria-label="حالة التسويق">
    {activeCounts.length > 0 ? <div className="marketing-overview-metrics">
      {activeCounts.map(({ name, value }) => <div className="marketing-overview-metric" key={name}>
        <span>{name}</span><strong>{value.toLocaleString("ar-YE")}</strong>
      </div>)}
    </div> : <p className="muted">لا توجد عروض أو مواد منشورة أو مسودات في الإجماليات الحالية.</p>}
    <details className="marketing-overview-source">
      <summary>عن الأرقام والمتابعة</summary>
      <p>الإجماليات من سجلات DSH حتى {new Date(summary.asOf).toLocaleString("ar-YE")}، وليست من الصفحة الأولى. لا تثبت أهلية التمويل أو توافر المتجر.</p>
      <p>عدد موافقات الشركاء غير متاح على مستوى الإجماليات؛ يجب مراجعة كل حملة في سجل العروض. أخطاء النشر تظهر في سجلاتها.</p>
      <Link href="/marketing/promotions">سجل العروض وموافقة الشركاء</Link>
    </details>
  </section>;
}
