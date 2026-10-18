"use client";

import type { OperatorMarketingSummary } from "@bthwani/dsh";
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
  return <>
    <div className="ops-summary-grid">
      {counts.map(({ name, value }) => <div className="ops-summary" key={name}><span>{name}</span><strong>{value.toLocaleString("ar-YE")}</strong></div>)}
    </div>
    <p className="muted" role="note">إجماليات كاملة من سجلات DSH، وليست أعداد أول صفحة. تم احتساب حالات النشر عند {new Date(summary.asOf).toLocaleString("ar-YE")}؛ ولا تعني أهلية التمويل أو توافر المتجر.</p>
    <div className="access-card">
      <h2>تنبيهات تحتاج إجراءً</h2>
      <p>موافقات المتاجر المنتظرة لم تُربط بعد بتقرير المشغّل؛ لا تُعرض كصفر.</p>
      <p>أخطاء النشر تُراجع من سجل كل محتوى أو عرض، ولا تُستنتج من عدد المسودات.</p>
    </div>
  </>;
}
