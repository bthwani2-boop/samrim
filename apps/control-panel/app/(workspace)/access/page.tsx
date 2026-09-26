"use client";

import { useState } from "react";

import { AccountAccessPanel } from "../../../src/features/access/account-access-panel";
import { OperatorDirectory } from "../../../src/features/access/operator-directory";
import { useSession } from "../../../src/session/session-provider";

export default function AccessPage() {
  const { state } = useSession();
  const [selectedPhone, setSelectedPhone] = useState("");
  if (state.kind !== "authenticated") return null;

  return (
    <section className="workspace-page" aria-labelledby="access-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الوصول</p>
        <h1 id="access-page-title">مشغّلو لوحة التحكم والصلاحيات</h1>
        <p className="lead">يعرض هذا المركز حسابات مشغّلي لوحة التحكم وصلاحياتهم الإدارية، ويقرأ الحالة الكانونية بعد كل تغيير.</p>
      </div>
      <OperatorDirectory onSelectPhone={setSelectedPhone} />
      <AccountAccessPanel selectedPhone={selectedPhone} />
    </section>
  );
}
