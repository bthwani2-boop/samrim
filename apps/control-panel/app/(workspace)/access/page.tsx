"use client";

import { PageHeader } from "../../../src/shell/page-header";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type MouseEvent } from "react";

import { AccountAccessPanel } from "../../../src/features/access/account-access-panel";
import { OperatorDirectory } from "../../../src/features/access/operator-directory";
import { HROperatorAccessQueue } from "../../../src/features/access/hr-operator-access-queue";
import { OperatorProfilePanel } from "../../../src/features/access/operator-profile-panel";
import { useSession } from "../../../src/session/session-provider";

function AccessWorkspace() {
  const { state } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedPhone, setSelectedPhone] = useState("");
  const [accountMutationBusy, setAccountMutationBusy] = useState(false);
  if (state.kind !== "authenticated") return null;

  const canManageProfiles = state.identity.canManageOperatorPermissions === true;
  const view = canManageProfiles && searchParams.get("view") === "permissions" ? "permissions" : canManageProfiles ? "profiles" : "permissions";
  const viewHref = (currentParams: URLSearchParams, nextView: "profiles" | "permissions") => {
    const params = new URLSearchParams();
    for (const key of ["profileState", "profileSort", "operatorSort"] as const) {
      const value = currentParams.get(key);
      if (value) params.set(key, value);
    }
    params.set("view", nextView);
    return `/access?${params.toString()}`;
  };
  const navigateView = (event: MouseEvent<HTMLAnchorElement>, nextView: "profiles" | "permissions") => {
    const href = viewHref(new URLSearchParams(window.location.search), nextView);
    event.currentTarget.href = href;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href, { scroll: false });
  };

  return <section className="workspace-page access-page" aria-labelledby="access-page-title">
    <PageHeader id="access-page-title" title="المشغّلون" />

    <nav className="access-view-nav" aria-label="إدارة المشغّلين">
      {canManageProfiles ? <Link href={viewHref(new URLSearchParams(searchParams.toString()), "profiles")} onClick={(event) => navigateView(event, "profiles")} aria-current={view === "profiles" ? "page" : undefined} className={view === "profiles" ? "is-active" : undefined}>ملفات المشغّلين</Link> : null}
      <Link href={viewHref(new URLSearchParams(searchParams.toString()), "permissions")} onClick={(event) => navigateView(event, "permissions")} aria-current={view === "permissions" ? "page" : undefined} className={view === "permissions" ? "is-active" : undefined}>الوصول والصلاحيات</Link>
    </nav>

    {view === "profiles" ? <><HROperatorAccessQueue /><OperatorProfilePanel /></> : <div className="access-permissions-view">
      <OperatorDirectory onSelectPhone={setSelectedPhone} selectedPhone={selectedPhone} selectionDisabled={accountMutationBusy} />
      {selectedPhone ? <AccountAccessPanel selectedPhone={selectedPhone} onClear={() => setSelectedPhone("")} onBusyChange={setAccountMutationBusy} /> : null}
    </div>}
  </section>;
}

function AccessLoading() {
  return <section className="workspace-page access-page" aria-busy="true"><div className="access-loading" role="status">جارٍ فتح مساحة المشغّلين…</div></section>;
}

export default function AccessPage() {
  return <Suspense fallback={<AccessLoading />}><AccessWorkspace /></Suspense>;
}
