"use client";

import type { OperatorMarketingSummary } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandBarPanel, CommandMetricStrip } from "../shared/command-surface";

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
        const counts = [
          value.activePromotions, value.scheduledPromotions, value.endedPromotions,
          value.draftPromotions, value.pausedPromotions, value.activeContent,
          value.partnerPending, value.partnerApproved, value.partnerDeclined,
        ];
        if (!counts.every(count => Number.isSafeInteger(count) && count >= 0) || !value.asOf)
          throw new Error("استجابة إجماليات التسويق غير صالحة.");
        if (!controller.signal.aborted) setSummary(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) { setSummary(null); setError("تعذرت قراءة إجماليات التسويق، ولا يمكن اعتبارها صفرًا."); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  if (loading || error || !summary) return <section className="bt-command-coverage" aria-busy={loading} data-testid="marketing-command">
    <CommandMetricStrip metrics={[
      { id:"active", label:"العروض الفعالة", value:null, description:"بانتظار بيانات DSH" },
      { id:"planned", label:"العروض المجدولة", value:null, description:"بانتظار بيانات DSH" },
      { id:"approval", label:"موافقات الشركاء", value:null, description:"بانتظار بيانات DSH" },
      { id:"content", label:"المحتوى المنشور", value:null, description:"بانتظار بيانات DSH" },
      { id:"draft", label:"المسودات", value:null, description:"بانتظار بيانات DSH" },
    ]}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="دورة حياة العروض" subtitle="لا يمكن حساب التوزيع حاليًا" measures={[]}/>
      <CommandBarPanel title="موافقات الشركاء" subtitle="لا يمكن حساب التوزيع حاليًا" measures={[]}/>
    </div>
    {loading ? <p role="status" className="bt-command-footnote">جارٍ قراءة إجماليات التسويق...</p>
      : <div role="alert" className="access-card"><p>{error || "إجماليات التسويق غير متاحة."}</p>
        <button className="button button-secondary" type="button" onClick={() => setRevision(n => n + 1)}>إعادة المحاولة</button>
      </div>}
  </section>;

  const metrics = [
    { id:"active", label:"العروض الفعالة", value:summary.activePromotions, description:"من إجماليات DSH", tone:"success" as const },
    { id:"planned", label:"عروض مجدولة", value:summary.scheduledPromotions, description:"بانتظار موعد البدء", tone:"normal" as const },
    { id:"review", label:"موافقات شركاء معلقة", value:summary.partnerPending, description:"تحتاج مراجعة حسب سجل العروض", tone:"warning" as const },
    { id:"published", label:"محتوى منشور", value:summary.activeContent, description:"مواد سارية", tone:"success" as const },
    { id:"draft", label:"مسودات الحملات", value:summary.draftPromotions, description:"لم تُنشر بعد", tone:"normal" as const },
  ];
  const promotional = [
    { id:"active", label:"فعال", value:summary.activePromotions, tone:"success" as const },
    { id:"scheduled", label:"مجدول", value:summary.scheduledPromotions },
    { id:"draft", label:"مسودة", value:summary.draftPromotions },
    { id:"paused", label:"موقوف", value:summary.pausedPromotions, tone:"warning" as const },
    { id:"ended", label:"منتهٍ", value:summary.endedPromotions },
  ];
  const approvals = [
    { id:"approved", label:"موافقة", value:summary.partnerApproved, tone:"success" as const },
    { id:"pending", label:"بانتظار الموافقة", value:summary.partnerPending, tone:"warning" as const },
    { id:"declined", label:"مرفوض", value:summary.partnerDeclined, tone:"danger" as const },
  ];
  return <section className="bt-command-coverage" aria-label="قيادة التسويق" data-testid="marketing-command">
    <CommandMetricStrip metrics={metrics}/>
    <div className="bt-command-grid">
      <CommandBarPanel title="دورة حياة العروض" subtitle="التوزيع الحالي من DSH" measures={promotional}/>
      <CommandBarPanel title="موافقات الشركاء" subtitle="الحالات المسجلة في حملات الشراكة" measures={approvals}/>
    </div>
    <div className="bt-command-grid">
      <section className="bt-command-panel" aria-label="الإجراءات التسويقية">
        <div className="bt-command-panel-head"><h2>الإجراءات الأساسية</h2><small>حسب صلاحيات القسم</small></div>
        <div className="marketing-entry-choices">
          <Link className="marketing-entry-choice" href="/marketing/promotions"><strong>إدارة الخصومات والحملات</strong><span>التمويل وموافقات الشركاء وسجل العروض.</span></Link>
          <Link className="marketing-entry-choice" href="/marketing/content"><strong>إدارة البنرات والمحتوى</strong><span>النشر والمواضع والمواد التسويقية.</span></Link>
        </div>
      </section>
      <section className="bt-command-panel" aria-label="مصدر مؤشرات التسويق">
        <div className="bt-command-panel-head"><h2>حالة البيانات</h2><small>إجماليات رسمية من DSH</small></div>
        <p className="bt-command-footnote">آخر تحديث: {new Date(summary.asOf).toLocaleString("ar-YE")}</p>
        <p className="bt-command-footnote">مؤشرات العروض والمواد المنشورة مستمدة من الإجماليات، وليست من الصفحة الأولى. لا تعادل المبيعات أو العائد المالي ولا تثبت أهلية التمويل.</p>
        <Link className="button button-secondary" href="/marketing/promotions">فتح سجل الحملات والموافقات ←</Link>
      </section>
    </div>
  </section>;
}
