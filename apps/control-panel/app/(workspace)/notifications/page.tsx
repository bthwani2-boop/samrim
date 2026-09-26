"use client";

import { OperatorNotifications } from "../../../src/features/notifications/operator-notifications";
import { useSession } from "../../../src/session/session-provider";

export default function NotificationsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>الإشعارات غير متاحة</h1><p className="muted">هذه الجلسة لا تملك دور المشغل المطلوب لقراءة إشعارات التشغيل.</p></div></section>;
  return <OperatorNotifications />;
}
