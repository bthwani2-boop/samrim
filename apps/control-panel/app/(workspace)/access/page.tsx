"use client";

import { AccountAccessPanel } from "../../../src/features/access/account-access-panel";
import { useSession } from "../../../src/session/session-provider";

export default function AccessPage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;

  return (
    <section className="workspace-page" aria-labelledby="access-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الوصول</p>
        <h1 id="access-page-title">الحسابات والأدوار</h1>
        <p className="lead">يدير مشغل لوحة التحكم الوصول، وتُقرأ الحالة الكانونية بعد كل تغيير.</p>
      </div>
      <AccountAccessPanel />
    </section>
  );
}
