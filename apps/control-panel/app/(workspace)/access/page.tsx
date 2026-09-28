"use client";

import { useState } from "react";

import { AccountAccessPanel } from "../../../src/features/access/account-access-panel";
import { OperatorDirectory } from "../../../src/features/access/operator-directory";
import { OperatorProfilePanel } from "../../../src/features/access/operator-profile-panel";
import { useSession } from "../../../src/session/session-provider";

export default function AccessPage() {
  const { state } = useSession();
  const [selectedPhone, setSelectedPhone] = useState("");
  const [tab, setTab] = useState<"profiles" | "permissions" | null>(null);
  if (state.kind !== "authenticated") return null;
  const canManageProfiles = state.identity.canManageOperatorPermissions === true;
  const activeTab = tab === "profiles" && !canManageProfiles ? "permissions" : tab ?? (canManageProfiles ? "profiles" : "permissions");

  return (
    <section className="workspace-page" aria-labelledby="access-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة الوصول</p>
        <h1 id="access-page-title">ملفات المشغّلين والوصول والصلاحيات</h1>
        <p className="lead">أنشئ ملف المشغّل وراجعه، ثم امنح الدور وأرسل دعوة التفعيل. تُدار صلاحيات الحسابات بعد منح الدور من تبويب مستقل.</p>
      </div>
      <fieldset className="workspace-tabs"><legend className="visually-hidden">إدارة المشغّلين</legend>
        {canManageProfiles ? <button id="operator-profiles-tab" type="button" aria-pressed={activeTab === "profiles"} className={activeTab === "profiles" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setTab("profiles")}>ملفات المشغّلين</button> : null}
        <button id="operator-permissions-tab" type="button" aria-pressed={activeTab === "permissions"} className={activeTab === "permissions" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setTab("permissions")}>الوصول والصلاحيات</button>
      </fieldset>
      {activeTab === "profiles" ? <div id="operator-profiles-panel"><OperatorProfilePanel /></div> : null}
      {activeTab === "permissions" ? <div id="operator-permissions-panel"><OperatorDirectory onSelectPhone={setSelectedPhone} /><AccountAccessPanel selectedPhone={selectedPhone} /></div> : null}
    </section>
  );
}
