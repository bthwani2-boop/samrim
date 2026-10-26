"use client";

import { Alert, Button, Empty, Flex, Listy, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

type ContactQueueItem = Readonly<{
  orderId: string;
  storeName: string;
  state: string;
  createdAt: string;
  lastContactState: string;
}>;
type ContactQueuePage = Readonly<{ items: ReadonlyArray<ContactQueueItem>; nextCursor: string }>;

export function CustomerContactQueue({ onOpenOrder, refreshVersion, active = true }: Readonly<{
  onOpenOrder: (orderId: string) => void;
  refreshVersion: number;
  active?: boolean;
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
    if (!active || refreshVersion < 0) return;
    void reload();
    return () => { sequence.current += 1; };
  }, [reload, refreshVersion, active]);
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => { if (!document.hidden && !moreBusy) void reload(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [reload, moreBusy, active]);

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

  return (
    <section className="order-detail-panel" aria-labelledby="ops-contact-queue-title">
      <Flex vertical gap="middle">
        <div>
          <h2 id="ops-contact-queue-title">التحقق من العملاء الجدد</h2>
          <Typography.Text type="secondary">
            طلبات تحتاج اتصال موظف العمليات. تأكيد المكالمة وحده لا يجعل الطلب ناجحًا؛ يحتسب النجاح بعد التسليم الموثق.
          </Typography.Text>
        </div>
        {loading && items.length === 0 ? (
          <Flex align="center" gap="small" role="status">
            <Spin size="small" />
            <Typography.Text type="secondary">جارٍ قراءة طلبات التحقق…</Typography.Text>
          </Flex>
        ) : null}
        {error ? (
          <Alert
            type="warning"
            showIcon
            message={error}
            action={<Button disabled={loading} onClick={() => void reload()}>إعادة القراءة</Button>}
          />
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <Empty description="لا توجد طلبات تحقق تحتاج اتصالًا ضمن هذا المصدر." />
        ) : null}
        {items.length > 0 ? (
          <Listy<ContactQueueItem>
            items={[...items]}
            rowKey="orderId"
            itemRender={(item) => (
              <Flex align="center" justify="space-between" gap="middle" wrap data-testid="ops-contact-item">
                <Flex vertical gap="small" flex="1" style={{ minWidth: 200, overflowWrap: "anywhere" }}>
                  <Typography.Text strong>{item.storeName}</Typography.Text>
                  <Typography.Text type="secondary">
                    رقم الطلب: <bdi dir="ltr">{item.orderId.slice(-8)}</bdi> · {item.lastContactState === "NO_ANSWER"
                      ? "سبق الاتصال دون رد" : item.lastContactState === "DENIED"
                      ? "العميل لم يؤكد الطلب" : item.lastContactState === "WRONG_NUMBER"
                      ? "رقم التواصل غير صحيح" : "لم يتم تأكيد الاتصال"}
                  </Typography.Text>
                </Flex>
                <Button onClick={() => onOpenOrder(item.orderId)} aria-label={`فتح الطلب وتسجيل الاتصال ${item.orderId}`}>
                  فتح الطلب وتسجيل الاتصال
                </Button>
              </Flex>
            )}
          />
        ) : null}
        {nextCursor ? (
          <Button block loading={moreBusy} disabled={loading} onClick={() => void loadMore()}>
            المزيد من طلبات التحقق
          </Button>
        ) : null}
      </Flex>
    </section>
  );
}
