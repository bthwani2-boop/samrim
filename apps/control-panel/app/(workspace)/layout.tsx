"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ControlShell, LoadingState, UnavailableState } from "../../src/shell/public-shell";
import { useSession } from "../../src/session/session-provider";
import { AppearanceControl } from "../../src/shell/appearance-control";
import { IdentitySurface } from "../../src/features/access/identity-surface";

function WorkspaceHeader({ busy, onLogout }: Readonly<{ busy: boolean; onLogout: () => void }>) {
  return (
    <header className="workspace-header">
      <Link className="brand-lockup brand-link" href="/workspace" aria-label="العودة إلى مساحة العمل">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </Link>
      <div className="workspace-actor-context">
        <span className="surface-label">المشغل</span>
        <span className="actor-context">لوحة التحكم · جلسة موثقة</span>
      </div>
      <details className="account-menu" open>
        <summary>حساب المشغل</summary>
        <div className="account-menu-panel">
          <AppearanceControl />
          <button type="button" className="button button-secondary workspace-logout" disabled={busy} onClick={onLogout}>
            {busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}
          </button>
        </div>
      </details>
    </header>
  );
}

function WorkspaceNavigation({ pathname }: Readonly<{ pathname: string }>) {
  const isCurrent = (href: string) => href === "/workspace" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <aside className="workspace-nav" aria-label="تنقل مساحة المشغل">
      <p className="workspace-nav-label">مسارات العمل</p>
      <Link className="workspace-nav-link" href="/workspace" aria-current={isCurrent("/workspace") ? "page" : undefined}>الرئيسية</Link>
      <Link className="workspace-nav-link" href="/operations" aria-current={isCurrent("/operations") ? "page" : undefined}>العمليات</Link>
      <Link className="workspace-nav-link" href="/partners" aria-current={isCurrent("/partners") ? "page" : undefined}>الشركاء والمتاجر</Link>
      <Link className="workspace-nav-link" href="/captains" aria-current={isCurrent("/captains") ? "page" : undefined}>الكباتن</Link>
      <Link className="workspace-nav-link" href="/fields" aria-current={isCurrent("/fields") ? "page" : undefined}>الميدان</Link>
      <Link className="workspace-nav-link" href="/catalog" aria-current={isCurrent("/catalog") ? "page" : undefined}>الكتالوج</Link>
      <p className="workspace-nav-label workspace-nav-label-spaced">الحماية</p>
      <Link className="workspace-nav-link" href="/access" aria-current={isCurrent("/access") ? "page" : undefined}>الوصول والأمان</Link>
    </aside>
  );
}

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const [localSignOut, setLocalSignOut] = useState(false);
  const { state, busy, restore, logout } = useSession();

  useEffect(() => { if (state.kind === "signed_out" && !state.notice && !localSignOut) router.replace("/"); }, [localSignOut, router, state]);
  useEffect(() => { if (pathname) mainRef.current?.focus(); }, [pathname]);

  if (state.kind === "loading") return <LoadingState title="جارٍ فتح مساحة العمل" message="نتحقق من جلسة المشغل قبل عرض المساحة." />;
  if (state.kind === "unavailable") return <UnavailableState message={state.message} onRetry={() => void restore()} busy={busy} />;
  if (state.kind === "signed_out" && (state.notice || localSignOut)) return <IdentitySurface />;
  if (state.kind === "signed_out") return <LoadingState title="جارٍ الرجوع إلى بوابة الهوية" message="انتهت الجلسة المحلية أو لم تعد متاحة." />;

  return (
    <ControlShell className="workspace-app-shell" surface="workspace" footer={null} header={<WorkspaceHeader busy={busy} onLogout={() => { setLocalSignOut(true); void logout(); }} />}>
      <a className="skip-link" href="#workspace-main">تخطي إلى المحتوى الرئيسي</a>
      <div className="workspace-layout">
        <WorkspaceNavigation pathname={pathname} />
        <main ref={mainRef} id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      </div>
    </ControlShell>
  );
}
