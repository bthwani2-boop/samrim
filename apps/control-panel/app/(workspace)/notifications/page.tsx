"use client";

import { PageHeader } from "../../../src/shell/page-header";

import { OperatorNotifications } from "../../../src/features/notifications/operator-notifications";
import { useSession } from "../../../src/session/session-provider";

export default function NotificationsPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><PageHeader title="الإشعارات غير متاحة" /><p className="muted">هذه الجلسة لا تملك دور المشغل المطلوب لقراءة إشعارات التشغيل.</p></div></section>;
  return <OperatorNotifications />;
}
