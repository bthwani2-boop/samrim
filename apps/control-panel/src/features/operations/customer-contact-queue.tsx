"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ContactQueueItem = Readonly<{
  orderId: string;
  storeName: string;
  state: string;
  createdAt: string;
  lastContactState: string;
}>;
type ContactQueuePage = Readonly<{ items: ReadonlyArray<ContactQueueItem>; nextCursor: string }>;

export function CustomerContactQueue({ onOpenOrder, refreshVersion }: Readonly<{
  onOpenOrder: (orderId: string) => void;
  refreshVersion: number;
}>) {
  const [items, setItems] = useState<ReadonlyArray<ContactQueueItem>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const read = useCallback(async (cursor = ""): Promise<ContactQueuePage> => {
    const query = new URLSearchParams({ limit: "10" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/operations/contact-queue?${query}`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("تعذر قراءة طلبات التحقق من العملاء.");
    const data = await response.json() as Partial<ContactQueuePage>;
    if (!Array.isArray(data.items) || typeof data.nextCursor !== "string"
      || !data.items.every((item) => item && typeof item.orderId === "string" && typeof item.storeName === "string")) {
      throw new Error("قائمة التحقق غير صالحة.");
    }
    return data as ContactQueuePage;
  }, []);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const page = await read();
      if (current !== sequence.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (current !== sequence.current) return;
      setItems([]);
      setNextCursor("");
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة قائمة الاتصالات.");
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [read]);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload, refreshVersion]);
  useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden && !moreBusy) void reload(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [reload, moreBusy]);

  async function loadMore() {
    if (!nextCursor || loading || moreBusy) return;
    const current = sequence.current;
    setMoreBusy(true);
    setError("");
    try {
      const page = await read(nextCursor);
      if (current !== sequence.current) return;
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.orderId));
        return [...previous, ...page.items.filter((item) => !seen.has(item.orderId))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : "تعذر جلب المزيد.");
    } finally {
      setMoreBusy(false);
    }
  }
  if (!loading && !error && items.length === 0) return null;
  return <section className="order-detail-panel" aria-labelledby="ops-contact-queue-title">
    <h2 id="ops-contact-queue-title">التحقق من العملاء الجدد</h2>
    <p className="muted">طلبات تحتاج اتصال موظف العمليات. تأكيد المكالمة وحده لا يجعل الطلب ناجحًا؛ يحتسب النجاح بعد التسليم الموثق.</p>
    {loading && items.length === 0 ? <p className="muted" role="status">جارٍ قراءة طلبات التحقق…</p> : null}
    {error ? <div role="alert" className="managed-status managed-status-warning">
      <p>{error}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void reload()}>إعادة القراءة</button>
    </div> : null}
    {items.length > 0 ? <ul className="order-detail-list">
      {items.map((item) => <li key={item.orderId}>
        <div><strong>{item.storeName}</strong>
          <p className="muted">رقم الطلب: <span dir="ltr">{item.orderId.slice(-8)}</span> · {item.lastContactState === "NO_ANSWER" ? "سبق الاتصال دون رد" : item.lastContactState === "DENIED" ? "العميل لم يؤكد الطلب" : item.lastContactState === "WRONG_NUMBER" ? "رقم التواصل غير صحيح" : "لم يتم تأكيد الاتصال"}</p>
        </div>
        <button type="button" className="button button-secondary" onClick={() => onOpenOrder(item.orderId)}>فتح الطلب وتسجيل الاتصال</button>
      </li>)}
    </ul> : null}
    {nextCursor ? <div className="action-row"><button type="button" className="button button-secondary" disabled={loading || moreBusy} onClick={() => void loadMore()}>
      {moreBusy ? "جارٍ عرض المزيد…" : "المزيد من طلبات التحقق"}
    </button></div> : null}
  </section>;
}
