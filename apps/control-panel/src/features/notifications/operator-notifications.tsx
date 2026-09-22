"use client";

import type { Notification, NotificationKind } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./operator-notifications.module.css";

type NotificationListPayload = Readonly<{ notifications?: ReadonlyArray<Notification>; unreadCount?: number }>;
type NotificationReadPayload = Readonly<{ notificationId: string; readAt: string }>;

export function OperatorNotifications() {
  const [items, setItems] = useState<ReadonlyArray<Notification>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (preserveCurrent = false) => {
    if (preserveCurrent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notifications?limit=100", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "تعذر قراءة إشعارات التشغيل.");
      }
      const payload = await response.json() as NotificationListPayload;
      setItems(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر قراءة إشعارات التشغيل.");
    } finally {
      if (preserveCurrent) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markRead(item: Notification) {
    if (item.readAt || pendingId) return;
    setPendingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "تعذر تحديث حالة الإشعار.");
      }
      const payload = await response.json() as NotificationReadPayload;
      setItems((current) => current.map((candidate) => candidate.id === payload.notificationId ? { ...candidate, readAt: payload.readAt } : candidate));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحديث حالة الإشعار.");
    } finally {
      setPendingId("");
    }
  }

  const unreadItems = useMemo(() => items.filter((item) => !item.readAt), [items]);
  const readItems = useMemo(() => items.filter((item) => Boolean(item.readAt)), [items]);

  return (
    <section className="workspace-page operator-notifications" aria-labelledby="notifications-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">مركز المتابعة</p>
        <h1 id="notifications-title">الإشعارات</h1>
        <p className="lead">تحديثات التشغيل التي تساعد المشغّل على التقاط الأعمال الجديدة ومتابعة تغيّر حالتها.</p>
      </div>

      <div className="operator-notifications-summary" aria-live="polite">
        <div>
          <p className="eyebrow">الحالة الحالية</p>
          <strong>{unreadCount} إشعارات غير مقروءة</strong>
          <p>{unreadCount ? "ابدأ بالأحدث لتبقى على اطلاع بمسار التشغيل." : "لا توجد إشعارات جديدة تحتاج إلى متابعة."}</p>
        </div>
        <button type="button" className="button button-secondary" disabled={loading || refreshing} onClick={() => void load(true)}>
          {refreshing ? "جارٍ التحديث…" : "تحديث الإشعارات"}
        </button>
      </div>

      {loading ? <div className="collection-state" role="status"><span className="loading-mark" aria-hidden="true" /><strong>جارٍ تجهيز الإشعارات</strong></div> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><strong>تعذر قراءة الإشعارات</strong><p>{error}</p></div> : null}
      {!loading && !error && !items.length ? <div className="access-card operator-notifications-empty"><p className="eyebrow">لا توجد تحديثات</p><h2>لا توجد إشعارات حالياً</h2><p className="muted">ستظهر هنا تحديثات العمليات وطلبات الانضمام عند تسجيل أحداث جديدة.</p></div> : null}
      {!loading && !error && unreadItems.length ? <NotificationGroup title="الجديدة" count={unreadItems.length} items={unreadItems} pendingId={pendingId} onMarkRead={markRead} /> : null}
      {!loading && !error && readItems.length ? <NotificationGroup title="المقروءة" count={readItems.length} items={readItems} pendingId={pendingId} onMarkRead={markRead} /> : null}
    </section>
  );
}

function NotificationGroup({ title, count, items, pendingId, onMarkRead }: Readonly<{ title: string; count: number; items: ReadonlyArray<Notification>; pendingId: string; onMarkRead: (item: Notification) => Promise<void> }>) {
  return (
    <section className="operator-notification-group" aria-labelledby={`notifications-${title}`}>
      <div className="operator-notification-group-heading">
        <h2 id={`notifications-${title}`}>{title}</h2>
        <span>{count}</span>
      </div>
      <div className="operator-notification-list">
        {items.map((item) => (
          <button key={item.id} type="button" className={`operator-notification-card${item.readAt ? " is-read" : " is-unread"}`} disabled={pendingId === item.id} onClick={() => void onMarkRead(item)} aria-label={`${item.title}، ${item.readAt ? "مقروء" : "جديد"}`}>
            <span className={`operator-notification-kind operator-notification-kind-${notificationKindTone(item.kind)}`} aria-hidden="true">{notificationKindLabel(item.kind)}</span>
            <span className="operator-notification-copy">
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <time dateTime={item.createdAt}>{formatNotificationDate(item.createdAt)}</time>
            </span>
            <span className="operator-notification-state">{item.readAt ? "مقروء" : "جديد"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function notificationKindTone(kind: NotificationKind) {
  if (kind.startsWith("FIELD_")) return "partner";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "delivery";
  return "order";
}

function notificationKindLabel(kind: NotificationKind) {
  if (kind.startsWith("FIELD_")) return "شريك";
  if (kind.startsWith("CAPTAIN_") || ["HANDOFF_CONFIRMED", "PICKED_UP", "DELIVERED", "DELIVERY_FAILED", "DELIVERY_RECOVERED", "REASSIGNED"].includes(kind)) return "توصيل";
  return "طلب";
}

function formatNotificationDate(value: string) {
  return new Date(value).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" });
}
