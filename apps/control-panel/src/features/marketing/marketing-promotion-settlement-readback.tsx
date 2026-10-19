"use client";

import { formatMoney, type PromotionSettlementSummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

export function MarketingPromotionSettlementReadback({ promotionId }: Readonly<{ promotionId: string }>) {
  const [expanded, setExpanded] = useState(false);
  const [record, setRecord] = useState<PromotionSettlementSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRecord(null);
    void fetch("/api/marketing/promotions/" + encodeURIComponent(promotionId) + "/settlement-summary", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذرت قراءة تسويات العرض من WLT.");
        const body = await response.json() as PromotionSettlementSummary;
        if (body.promotionId !== promotionId || body.basis !== "POSTED_SETTLEMENT_NOT_NET_REFUNDS") throw new Error("استجابة التسويات غير صالحة.");
        if (!controller.signal.aborted) setRecord(body);
      })
      .catch(() => { if (!controller.signal.aborted) setError("القراءة المالية غير متاحة الآن؛ لا يمكن اعتماد أي مبلغ."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expanded, promotionId]);

  return <div className="work-stack">
    <button type="button" className="button button-quiet" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>نتائج التسوية</button>
    {expanded ? <section className="access-card" aria-label="نتائج تسوية العرض">
      {loading ? <p role="status">جارٍ قراءة القيود من WLT...</p> : error ? <p role="alert">{error}</p> : record ? <>
        <dl className="marketing-analytics-breakdown">
          <div><dt>طلبات وصلت للتسوية</dt><dd>{record.settledOrderCount.toLocaleString("ar-YE")}</dd></div>
          <div><dt>إجمالي الخصومات المسوّاة</dt><dd>{formatMoney(record.settledDiscountMinor, "YER")}</dd></div>
          <div><dt>حصة الشريك في الخصومات</dt><dd>{formatMoney(record.partnerFundedMinor, "YER")}</dd></div>
          <div><dt>حصة بثواني المجمدة</dt><dd>{formatMoney(record.platformFrozenMinor, "YER")}</dd></div>
          <div><dt>مصروف بثواني المرحّل في القيود</dt><dd>{formatMoney(record.platformPostedExpenseMinor, "YER")}</dd></div>
        </dl>
        <p className="muted">النتائج تخص التسويات المسجلة فقط، وليست صافي المصروف بعد الاستردادات أو إجمالي الطلبات المكتملة في DSH.</p>
      </> : null}
    </section> : null}
  </div>;
}
