"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ActorIdentity } from "@bthwani/identity";
import { ControlShell, LoadingState, UnavailableState } from "../components/public-shell";
import { useSession } from "../components/session-provider";

function actorLabel(identity: ActorIdentity): string {
  return identity.role === "platform_owner" ? "مالك المنصة" : "موظف لوحة التحكم";
}

function WorkspaceHeader({ identity, busy, onLogout }: Readonly<{ identity: ActorIdentity; busy: boolean; onLogout: () => void }>) {
  return (
    <header className="workspace-header">
      <Link className="brand-lockup brand-link" href="/workspace" aria-label="العودة إلى مساحة العمل">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </Link>
      <div className="workspace-actor-context">
        <span className="surface-label">مساحة العمل الموثقة</span>
        <span className="actor-context">{actorLabel(identity)} · {identity.surface}</span>
      </div>
      <button type="button" className="button button-secondary workspace-logout" disabled={busy} onClick={onLogout}>
        {busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}
      </button>
    </header>
  );
}

function WorkspaceNavigation({ identity, pathname }: Readonly<{ identity: ActorIdentity; pathname: string }>) {
  const isOwner = identity.role === "platform_owner";
  const canBootstrapPartner = isOwner || identity.role === "operator";
  return (
    <nav className="workspace-nav" aria-label="تنقل مساحة العمل">
      <p className="workspace-nav-label">المساحة الحالية</p>
      <Link className="workspace-nav-link" href="/workspace" aria-current={pathname === "/workspace" ? "page" : undefined}>
        نظرة الهوية
      </Link>
      {isOwner ? (
        <>
          <p className="workspace-nav-label workspace-nav-label-spaced">إدارة الوصول</p>
          <Link className="workspace-nav-link" href="/access" aria-current={pathname === "/access" ? "page" : undefined}>
            الحسابات والأدوار
          </Link>
        </>
      ) : null}
      {canBootstrapPartner ? (
        <>
          <p className="workspace-nav-label workspace-nav-label-spaced">التشغيل</p>
          <Link className="workspace-nav-link" href="/partners" aria-current={pathname === "/partners" ? "page" : undefined}>
            تهيئة الشركاء
          </Link>
        </>
      ) : null}
    </nav>
  );
}

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const { state, busy, restore, logout } = useSession();

  useEffect(() => {
    if (state.kind === "signed_out") router.replace("/");
  }, [router, state.kind]);

  useEffect(() => {
    if (pathname) mainRef.current?.focus();
  }, [pathname]);

  if (state.kind === "loading") {
    return <LoadingState title="جارٍ فتح مساحة العمل" message="نتحقق من جلسة المشغل قبل عرض المساحة." />;
  }

  if (state.kind === "unavailable") {
    return <UnavailableState message={state.message} onRetry={() => void restore()} busy={busy} />;
  }

  if (state.kind === "signed_out") {
    return <LoadingState title="جارٍ الرجوع إلى بوابة الهوية" message="انتهت الجلسة المحلية أو لم تعد متاحة." />;
  }

  return (
    <ControlShell
      className="workspace-app-shell"
      header={<WorkspaceHeader identity={state.identity} busy={busy} onLogout={() => void logout()} />}
    >
      <div className="workspace-layout">
        <WorkspaceNavigation identity={state.identity} pathname={pathname} />
        <main ref={mainRef} id="workspace-main" className="workspace-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </ControlShell>
  );
}
