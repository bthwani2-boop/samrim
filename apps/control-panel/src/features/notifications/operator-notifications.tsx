"use client";

import type { Notification } from "@bthwani/dsh";
import { Alert, Button, Empty, Flex, Listy, Spin, Tag, Typography } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../shell/page-header";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { operationNotificationHref } from "./notification-operation-link";
import { notificationBody, notificationHref, notificationKindLabel, notificationKindTone, notificationTitle } from "./notification-presentation";
import { parseOperatorNotificationList } from "./notification-readback";

type NotificationReadPayload = Readonly<{ notificationId: string; readAt: string }>;
type NotificationHistory = Readonly<{ operatorNotificationCursors?: ReadonlyArray<string> }>;
const notificationPageSize = 50;

export function OperatorNotifications() {
  const [items, setItems] = useState<ReadonlyArray<Notification>>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(10);
  const [routeStateReady, setRouteStateReady] = useState(false);
  const requestSequence = useRef(0);
  const readMutationInFlight = useRef(false);

  useEffect(() => {
    const syncPageFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const history = window.history.state as NotificationHistory | null;
      setCursor(params.get("cursor") ?? "");
      setCursorStack(history?.operatorNotificationCursors ?? []);
      setVisibleLimit(10);
    };
    syncPageFromUrl();
    setRouteStateReady(true);
    window.addEventListener("popstate", syncPageFromUrl);
    return () => window.removeEventListener("popstate", syncPageFromUrl);
  }, []);

  const load = useCallback(async (pageCursor: string, preserveCurrent = false): Promise<boolean> => {
    const sequence = ++requestSequence.current;
    if (preserveCurrent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(notificationPageSize) });
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "تعذر قراءة إشعارات التشغيل.");
      }
      const payload = parseOperatorNotificationList(await response.json());
      if (sequence !== requestSequence.current) return false;
      setItems(payload.notifications);
      setUnreadCount(payload.unreadCount);
      setNextCursor(payload.nextCursor ?? "");
      return true;
    } catch (cause) {
      if (sequence !== requestSequence.current) return false;
      if (!preserveCurrent) {
        setItems([]);
        setUnreadCount(null);
        setNextCursor("");
      }
      setError(cause instanceof Error && cause.message !== "INVALID_OPERATOR_NOTIFICATIONS" ? cause.message : "تعذر التحقق من قائمة إشعارات التشغيل. أعد المحاولة.");
      return false;
    } finally {
      if (sequence === requestSequence.current) {
        if (preserveCurrent) setRefreshing(false); else setLoading(false);
      }
    }
  }, []);

  useReadOnReturn(() => load(cursor, true), routeStateReady && !loading && !refreshing && !pendingId);

  useEffect(() => {
    if (!routeStateReady) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pendingId && !readMutationInFlight.current) void load(cursor, true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [cursor, load, pendingId, routeStateReady]);

  useEffect(() => {
    if (routeStateReady) void load(cursor);
  }, [cursor, load, routeStateReady]);

  function navigatePage(pageCursor: string, pageStack: ReadonlyArray<string>) {
    const url = new URL(window.location.href);
    if (pageCursor) url.searchParams.set("cursor", pageCursor); else url.searchParams.delete("cursor");
    const previousState = window.history.state;
    const historyState = previousState && typeof previousState === "object" ? previousState : {};
    window.history.pushState({ ...historyState, operatorNotificationCursors: pageStack }, "", `${url.pathname}${url.search}${url.hash}`);
    setCursor(pageCursor);
    setCursorStack(pageStack);
    setVisibleLimit(10);
  }

  async function markRead(item: Notification) {
    if (item.readAt || pendingId || readMutationInFlight.current) return;
    readMutationInFlight.current = true;
    setPendingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "تعذر تحديث حالة الإشعار.");
      }
      const payload = await response.json() as NotificationReadPayload;
      if (payload?.notificationId !== item.id || typeof payload.readAt !== "string" || !Number.isFinite(Date.parse(payload.readAt))) {
        throw new Error("INVALID_NOTIFICATION_READBACK");
      }
      if (!(await load(cursor, true))) setError("وصل تأكيد القراءة، لكن تعذرت قراءة الحالة الحالية للإشعارات. أعد المحاولة.");
    } catch {
      const verified = await load(cursor, true);
      setError(verified
        ? "لم نتأكد من نتيجة تحديد الإشعار كمقروء؛ تم تحديث القائمة من الخادم."
        : "لم نتأكد من نتيجة تحديد الإشعار كمقروء وتعذرت إعادة القراءة. أعد تحديث الإشعارات قبل محاولة أخرى.");
    } finally {
      readMutationInFlight.current = false;
      setPendingId("");
    }
  }


  const unreadItems = useMemo(() => items.filter((item) => !item.readAt), [items]);
  const readItems = useMemo(() => items.filter((item) => Boolean(item.readAt)), [items]);
  const visibleUnread = unreadItems.slice(0, visibleLimit);
  const visibleRead = readItems.slice(0, Math.max(0, visibleLimit - unreadItems.length));

  return (
    <section className="workspace-page" aria-labelledby="notifications-title">
      <PageHeader title="الإشعارات" id="notifications-title" status={!loading && !error && unreadCount !== null ? <Tag color="orange">{unreadCount} إشعارات غير مقروءة</Tag> : null} />

      {loading ? <div className="collection-state" role="status"><Spin /><strong>جارٍ تجهيز الإشعارات</strong></div> : null}
      {error ? <Alert type="warning" showIcon message="تعذر قراءة الإشعارات" description={error} action={<Button disabled={loading || refreshing || Boolean(pendingId)} onClick={() => void load(cursor, true)}>إعادة المحاولة</Button>} /> : null}
      {!loading && !error && !items.length ? <Empty description="لا توجد إشعارات حالياً" /> : null}
      {!loading && items.length ? <Typography.Text type="secondary" role="status">عرض {Math.min(visibleLimit, items.length)} من {items.length} إشعارًا في الصفحة</Typography.Text> : null}
      {!loading && visibleUnread.length ? <NotificationGroup title="الجديدة" count={unreadItems.length} items={visibleUnread} pendingId={pendingId} onMarkRead={markRead} /> : null}
      {!loading && visibleRead.length ? <NotificationGroup title="المقروءة" count={readItems.length} items={visibleRead} pendingId={pendingId} onMarkRead={markRead} /> : null}
      {!loading && !error && visibleLimit < items.length ? <Button onClick={() => setVisibleLimit((current) => current + 10)}>عرض ١٠ إشعارات إضافية</Button> : null}
      {!loading && (cursor || cursorStack.length > 0 || nextCursor) ? <Flex gap="small" justify="flex-end" align="center" wrap role="navigation" aria-label="صفحات الإشعارات">
        <Button disabled={loading || refreshing || Boolean(pendingId) || (cursorStack.length === 0 && !cursor)} onClick={() => { const previous = [...cursorStack]; const previousCursor = previous.pop() ?? ""; navigatePage(previousCursor, previous); }}>الأحدث</Button>
        <span>صفحة {cursorStack.length + 1}</span>
        <Button disabled={loading || refreshing || Boolean(pendingId) || !nextCursor} onClick={() => navigatePage(nextCursor, [...cursorStack, cursor])}>الأقدم</Button>
      </Flex> : null}
    </section>
  );
}

function NotificationGroup({ title, count, items, pendingId, onMarkRead }: Readonly<{ title: string; count: number; items: ReadonlyArray<Notification>; pendingId: string; onMarkRead: (item: Notification) => Promise<void> }>) {
  return (
    <section aria-labelledby={`notifications-${title}`}>
      <Flex align="center" justify="space-between" gap="small">
        <h2 id={`notifications-${title}`}>{title}</h2>
        <Tag>{count}</Tag>
      </Flex>
      <Listy<Notification>
        items={[...items]}
        rowKey="id"
        itemRender={(item) => {
          const linkedRecordHref = item.joiningCaseId?.trim() || item.storeId?.trim() ? notificationHref(item) : null;
          const orderHref = operationNotificationHref(item.orderId);
          return (
            <Flex vertical gap="small" aria-label={`${notificationTitle(item)}، ${item.readAt ? "مقروء" : "جديد"}`}>
              <Flex align="center" gap="small" wrap>
                <Tag color={notificationKindTone(item.kind) === "delivery" ? "green" : "blue"}>{notificationKindLabel(item.kind)}</Tag>
                <Typography.Text strong>{notificationTitle(item)}</Typography.Text>
                <Tag color={item.readAt ? "default" : "orange"}>{item.readAt ? "مقروء" : "جديد"}</Tag>
              </Flex>
              <Typography.Text>{notificationBody(item)}</Typography.Text>
              <Typography.Text type="secondary"><time dateTime={item.createdAt}>{formatNotificationDate(item.createdAt)}</time></Typography.Text>
              <Flex align="center" gap="small" wrap>
                {linkedRecordHref ? <Link href={linkedRecordHref}>فتح السجل</Link> : null}
                {orderHref ? <Link href={orderHref} aria-label={`فتح الطلب المرتبط بإشعار ${notificationTitle(item)}`}>فتح الطلب</Link> : null}
                {!item.readAt ? <Button type="link" disabled={Boolean(pendingId)} onClick={() => void onMarkRead(item)} aria-label={`تمييز ${notificationTitle(item)} كمقروء`}>تمييز كمقروء</Button> : null}
              </Flex>
            </Flex>
          );
        }}
      />
    </section>
  );
}

function formatNotificationDate(value: string) {
  return new Date(value).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" });
}
