"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, Suspense, useState } from "react";
import { AccountAccessPanel } from "../../../src/features/access/account-access-panel";
import { HROperatorAccessQueue } from "../../../src/features/access/hr-operator-access-queue";
import { OperatorDirectory } from "../../../src/features/access/operator-directory";
import { OperatorProfilePanel } from "../../../src/features/access/operator-profile-panel";
import { useSession } from "../../../src/session/session-provider";
import { PageHeader } from "../../../src/shell/page-header";

type AccessView = "requests" | "operators" | "permissions";

function AccessWorkspace() {
  const { state } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [selectedPhone, setSelectedPhone] = useState("");
  const [accountMutationBusy, setAccountMutationBusy] = useState(false);
  if (state.kind !== "authenticated") return null;

  const root = state.identity.canManageOperatorPermissions === true;
  const requestedView = params.get("view");
  const view: AccessView = !root ? "permissions"
    : requestedView === "operators" || requestedView === "profiles" ? "operators"
    : requestedView === "permissions" ? "permissions" : "requests";

  function href(target: AccessView): string {
    const next = new URLSearchParams();
    if (target === "operators") {
      for (const key of ["profileState", "profileSort"] as const) {
        const value = params.get(key);
        if (value) next.set(key, value);
      }
    }
    if (target === "permissions") {
      const sort = params.get("operatorSort");
      if (sort) next.set("operatorSort", sort);
    }
    next.set("view", target);
    return `/access?${next.toString()}`;
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, target: AccessView) {
    const url = href(target);
    event.currentTarget.href = url;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(url, { scroll: false });
  }

  return <section className="workspace-page access-page" aria-labelledby="access-page-title">
    <PageHeader id="access-page-title" title="الوصول والصلاحيات" />
    <p className="muted">تُنشئ الموارد البشرية سجل الموظف وترفع طلب الوصول؛ يراجع المشغّل الأساسي الطلب ويقرر الصلاحيات، وتتولى الهوية تفعيل الحساب.</p>
    <nav className="access-view-nav" aria-label="أقسام الوصول والصلاحيات">
      {root ? <Link href={href("requests")} onClick={(event) => navigate(event, "requests")} aria-current={view === "requests" ? "page" : undefined}>طلبات الوصول</Link> : null}
      {root ? <Link href={href("operators")} onClick={(event) => navigate(event, "operators")} aria-current={view === "operators" ? "page" : undefined}>حسابات المشغّلين</Link> : null}
      <Link href={href("permissions")} onClick={(event) => navigate(event, "permissions")} aria-current={view === "permissions" ? "page" : undefined}>الصلاحيات</Link>
    </nav>
    {view === "requests" ? <HROperatorAccessQueue /> : null}
    {view === "operators" ? <OperatorProfilePanel /> : null}
    {view === "permissions" ? <div className="access-permissions-view">
      <OperatorDirectory onSelectPhone={setSelectedPhone} selectedPhone={selectedPhone} selectionDisabled={accountMutationBusy} />
      {selectedPhone ? <AccountAccessPanel selectedPhone={selectedPhone} onClear={() => setSelectedPhone("")} onBusyChange={setAccountMutationBusy} /> : null}
    </div> : null}
  </section>;
}

export default function AccessPage() {
  return <Suspense fallback={<section className="workspace-page access-page" aria-busy="true"><div className="access-loading" role="status">جارٍ تحميل الوصول والصلاحيات…</div></section>}>
    <AccessWorkspace />
  </Suspense>;
}
