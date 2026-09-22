"use client";

import { formatMoney, type CashLiabilityItem } from "@bthwani/dsh";
import { useCallback, useEffect, useState } from "react";
import { isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";
import "./cash-custody-workspace.module.css";

type CashCustodyResponse = Readonly<{ items?: ReadonlyArray<CashLiabilityItem>; totalAmountMinor?: number }>;

export function CashCustodyWorkspace() {
  const [items, setItems] = useState<ReadonlyArray<CashLiabilityItem>>([]);
  const [totalAmountMinor, setTotalAmountMinor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/finance/cash-custody", { cache: "no-store" });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      const body = await response.json() as CashCustodyResponse;
      setItems(body.items ?? []);
      setTotalAmountMinor(body.totalAmountMinor ?? 0);
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر قراءة حفظ النقد التشغيلي.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="cash-custody-workspace" aria-labelledby="cash-custody-title">
      <div className="finance-summary-grid">
        <article className="finance-summary-card">
          <p className="eyebrow">إجمالي القراءة الحالية</p>
          <strong dir="ltr"><bdi>{formatMoney(totalAmountMinor, "YER")}</bdi></strong>
          <span>التزامات نقدية محصلة ضمن الإسقاط الحالي</span>
        </article>
        <article className="finance-summary-card">
          <p className="eyebrow">العناصر</p>
          <strong>{items.length}</strong>
          <span>حالات جمع نقد COD في القراءة الحالية</span>
        </article>
      </div>

      <div className="finance-boundary-note" role="note">
        <strong>حدود هذه المساحة</strong>
        <p>البيانات مصدرها السجل المالي الكانوني، والقراءة هنا تخص حفظ النقد فقط. طلبات التسوية والوجهات الرسمية تظهر في مساحة التسوية الموحدة أدناه.</p>
      </div>

      <div className="finance-toolbar">
        <h2 id="cash-custody-title">النقد المحصل عند الاستلام</h2>
        <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>

      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة حفظ النقد</strong><p>{error}</p><button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>إعادة المحاولة</button></div> : null}
      {loading && items.length === 0 ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ قراءة حفظ النقد</strong><p>نطلب القراءة المالية الكانونية المخصصة لهذه المساحة.</p></div> : null}
      {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا يوجد نقد مفتوح في عهدة الكباتن</strong><p>تظهر هنا فقط حالات COD التي تم تحصيلها ولم تسجل لها حوالة نقدية.</p></div> : null}
      {items.length > 0 ? (
        <div className="finance-table-wrap">
          <table className="finance-table">
            <caption className="visually-hidden">النقد المفتوح في عهدة الكباتن</caption>
            <thead><tr><th scope="col">مرجع الطلب</th><th scope="col">الكابتن</th><th scope="col">المبلغ</th><th scope="col">وقت التحصيل</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.paymentIntentId}><th scope="row"><bdi dir="ltr">{item.externalReference}</bdi></th><td><bdi dir="ltr">{item.captainActorId}</bdi></td><td dir="ltr"><bdi>{formatMoney(item.amountMinor, item.currency)}</bdi></td><td><time dateTime={item.collectedAt}>{new Date(item.collectedAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
