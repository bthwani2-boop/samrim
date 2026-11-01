"use client";

import type { PartnerStoreOrderSummary } from "@bthwani/dsh";
import { useEffect, useState } from "react";

const periods = [
  { value: "7d", label: "7 أيام" },
  { value: "30d", label: "30 يومًا" },
  { value: "all", label: "كل الفترات" },
] as const;

export function StoreCustomerActivitySummary({ storeId }: Readonly<{ storeId: string }>) {
  const [period, setPeriod] = useState<"7d" | "30d" | "all">("30d");
  const [summary, setSummary] = useState<PartnerStoreOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // A retry deliberately invalidates the current read without changing its scope.
    void retry;
    const controller = new AbortController();
    setSummary(null); setError(""); setLoading(true);
    void fetch("/api/stores/" + encodeURIComponent(storeId) + "/orders/summary?period=" + period,
      { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("STORE_ORDER_SUMMARY_FAILED");
        return await response.json() as { summary: PartnerStoreOrderSummary };
      })
      .then(data => {
        if (controller.signal.aborted) return;
        if (!data.summary || data.summary.storeId !== storeId || data.summary.period !== period ||
          !Number.isSafeInteger(data.summary.completedCustomers) || !Number.isSafeInteger(data.summary.returningCustomers) ||
          data.summary.completedCustomers < 0 || data.summary.returningCustomers < 0 ||
          data.summary.returningCustomers > data.summary.completedCustomers) throw new Error("STORE_CUSTOMERS_SCOPE_MISMATCH");
        setSummary(data.summary);
      })
      .catch(() => { if (!controller.signal.aborted) setError("تعذر قراءة نشاط عملاء المتجر من DSH. تحقق من الاتصال والصلاحية ثم أعد المحاولة."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, period, retry]);

  return <section aria-label="مؤشرات عملاء المتجر">
    <p className="store-profile-muted">عدد العملاء الذين أتموا طلبًا؛ والتكرار يعني طلبين مكتملين على الأقل خلال الفترة نفسها. لا تُعرض بيانات أو معرفات العملاء الشخصية.</p>
    <fieldset className="store-product-actions" aria-label="الفترة الإحصائية" style={{ border: 0, padding: 0, minWidth: 0 }}>
      {periods.map(item => <button key={item.value} type="button" className={"button " + (period === item.value ? "button-primary" : "button-secondary")}
        aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</button>)}
    </fieldset>
    {loading ? <p role="status">جارٍ قراءة إحصاءات العملاء…</p> : null}
    {error ? <p role="alert">{error} <button type="button" className="button button-secondary" onClick={() => setRetry(value => value+1)}>إعادة المحاولة</button></p> : null}
    {summary && !loading && !error ? <dl className="store-profile-facts">
      <div><dt>عملاء أكملوا طلبًا</dt><dd>{summary.completedCustomers.toLocaleString("ar-YE")}</dd></div>
      <div><dt>عملاء كرروا الشراء</dt><dd>{summary.returningCustomers.toLocaleString("ar-YE")}</dd></div>
      <div><dt>الطلبات المكتملة</dt><dd>{(summary.deliveredOrders + summary.pickedUpOrders).toLocaleString("ar-YE")}</dd></div>
    </dl> : null}
  </section>;
}
