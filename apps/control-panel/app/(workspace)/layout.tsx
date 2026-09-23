"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, Fragment, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { ActorIdentity } from "@bthwani/identity";
import { IdentitySurface } from "../../src/features/access/identity-surface";
import { currentWorkspaceChild, currentWorkspaceDestination, isCurrentWorkspaceDestination, isCurrentWorkspacePath, workspaceDestinations, workspaceSearchEntries } from "../../src/navigation/workspace-registry";
import { identityFetch } from "../../src/session/identity-fetch";
import { useSession } from "../../src/session/session-provider";
import { AppearanceControl } from "../../src/shell/appearance-control";
import { ControlShell, LoadingState, UnavailableState } from "../../src/shell/public-shell";
import "../../src/features/access/access-surface.module.css";
import "../../src/shell/workspace-shell.module.css";
import "../../src/shell/responsive-shell.module.css";

function currentChild(pathname: string, destination: (typeof workspaceDestinations)[number]) {
  const child = currentWorkspaceChild(pathname, destination);
  if (child) return child;
  return destination.href === "/partners" && pathname.startsWith("/partners/")
    ? { href: pathname, label: "تفاصيل طلب الانضمام" }
    : null;
}

function WorkspaceBreadcrumbs({ pathname }: Readonly<{ pathname: string }>) {
  const current = currentWorkspaceDestination(pathname);
  const child = currentChild(pathname, current);
  const isHome = current.href === "/workspace";

  return (
    <nav className="workspace-breadcrumbs" aria-label="مسار الصفحة">
      <ol>
        {isHome ? (
          <li aria-current="page"><span>{current.label}</span></li>
        ) : (
          <>
            <li><Link href="/workspace">الرئيسية</Link></li>
            <li>
              {child ? <Link href={current.href}>{current.label}</Link> : <span aria-current="page">{current.label}</span>}
            </li>
            {child ? <li aria-current="page"><span>{child.label}</span></li> : null}
          </>
        )}
      </ol>
    </nav>
  );
}

function formatAccountSessionExpiry(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير محدد" : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function OperatorProfile({ identity, active }: Readonly<{ identity: ActorIdentity; active: boolean }>) {
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneUnavailable, setPhoneUnavailable] = useState(false);

  useEffect(() => {
    if (!active || phone) return;
    let cancelled = false;
    setPhoneLoading(true);
    setPhoneUnavailable(false);
    void identityFetch("/api/auth/profile", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("operator profile request failed");
        const profile = (await response.json()) as { phoneE164?: unknown };
        if (typeof profile.phoneE164 !== "string" || !profile.phoneE164.trim()) throw new Error("operator phone is unavailable");
        if (!cancelled) setPhone(profile.phoneE164.trim());
      })
      .catch(() => {
        if (!cancelled) setPhoneUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setPhoneLoading(false);
      });
    return () => { cancelled = true; };
  }, [active, phone]);

  return (
    <section className="operator-profile" aria-label="ملف المشغّل">
      <div className="operator-profile-heading">
        <span className="operator-profile-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" />
          </svg>
        </span>
        <div className="operator-profile-copy">
          <p className="operator-profile-title">{identity.role === "operator" ? "مشغّل المنصة" : "حساب معتمد"}</p>
          <p>حساب لوحة التحكم</p>
        </div>
      </div>
      <p className="operator-profile-status">جلسة نشطة</p>
      <dl className="operator-profile-details">
        <div><dt>اسم المشغّل</dt><dd>مشغّل المنصة</dd></div>
        <div><dt>رقم الهاتف</dt><dd aria-live="polite"><bdi dir="ltr">{phoneLoading ? "جارٍ تحميل الرقم…" : phoneUnavailable ? "تعذر تحميله" : phone ?? "افتح الحساب لعرض الرقم"}</bdi></dd></div>
        <div><dt>الوصول إلى المالية</dt><dd>{identity.permissions?.includes("finance") ? "مفعّل" : "غير مفعّل"}</dd></div>
        {identity.canManageFinanceAccess ? <div><dt>إدارة صلاحيات المالية</dt><dd>متاحة</dd></div> : null}
        <div>
          <dt>انتهاء الجلسة</dt>
          <dd><time dir="auto" dateTime={identity.expiresAt}>{formatAccountSessionExpiry(identity.expiresAt)}</time></dd>
        </div>
      </dl>
    </section>
  );
}

function WorkspaceHeader({
  busy,
  navOpen,
  navTriggerRef,
  onLogout,
  onOpenNavigation,
  pathname
}: Readonly<{
  busy: boolean;
  navOpen: boolean;
  navTriggerRef: RefObject<HTMLButtonElement | null>;
  onLogout: () => void;
  onOpenNavigation: () => void;
  pathname: string;
}>) {
  const router = useRouter();
  const { state } = useSession();
  const identity = state.kind === "authenticated" ? state.identity : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasFinancePermission = state.kind === "authenticated" && state.identity.permissions?.includes("finance") === true;
  const searchEntries = hasFinancePermission ? workspaceSearchEntries : workspaceSearchEntries.filter((entry) => !entry.href.startsWith("/finance"));
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("ar");
  const searchResults = normalizedSearch
    ? searchEntries.filter((entry) => entry.searchText.toLocaleLowerCase("ar").includes(normalizedSearch)).slice(0, 12)
    : [];

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setSearchQuery("");
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (navOpen || pathname !== "") {
      setSearchOpen(false);
      setSearchQuery("");
    }
  }, [navOpen, pathname]);

  function closeSearch(restoreFocus = false) {
    setSearchOpen(false);
    setSearchQuery("");
    if (restoreFocus) window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstResult = searchResults[0];
    if (!firstResult) return;
    closeSearch();
    router.push(firstResult.href);
  }

  return (
    <header className="workspace-header" data-search-open={searchOpen ? "true" : "false"}>
      <Link className="brand-lockup brand-link" href="/workspace" aria-label="العودة إلى مساحة العمل">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </Link>
      <div className="workspace-actor-context">
        <WorkspaceBreadcrumbs pathname={pathname} />
        <span className="actor-context">لوحة التحكم · جلسة موثقة</span>
      </div>
      <div className="workspace-header-tools">
        <Link className="workspace-notifications-link" href="/notifications" aria-current={pathname === "/notifications" ? "page" : undefined}>الإشعارات</Link>
        <search className="workspace-search-control" aria-label="البحث في صفحات لوحة التحكم">
          <button
            ref={searchTriggerRef}
            className="workspace-search-trigger"
            type="button"
            aria-label="البحث في صفحات لوحة التحكم"
            aria-expanded={searchOpen}
            aria-controls="workspace-search-panel"
            onClick={() => {
              if (searchOpen) closeSearch(true);
              else setSearchOpen(true);
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <circle cx="10.8" cy="10.8" r="6.4" />
              <path d="m15.5 15.5 5 5" />
            </svg>
          </button>
          {searchOpen ? (
            <form className="workspace-search-form" onSubmit={submitSearch}>
              <label className="visually-hidden" htmlFor="workspace-search-input">البحث في صفحات لوحة التحكم</label>
              <input
                ref={searchInputRef}
                id="workspace-search-input"
                type="search"
                autoComplete="off"
                placeholder="ابحث عن صفحة أو مساحة"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <button type="button" className="workspace-search-close" aria-label="إغلاق البحث" onClick={() => closeSearch(true)}>×</button>
            </form>
          ) : null}
        </search>
        <details className="account-menu" onToggle={(event) => setAccountMenuOpen(event.currentTarget.open)}>
          <summary>حساب المشغل</summary>
          <div className="account-menu-panel">
            {identity ? <OperatorProfile key={identity.subject} identity={identity} active={accountMenuOpen} /> : null}
            <AppearanceControl />
            <button type="button" className="button button-secondary workspace-logout" disabled={busy} onClick={onLogout}>
              {busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}
            </button>
          </div>
        </details>
        <button
          ref={navTriggerRef}
          className="workspace-nav-toggle"
          type="button"
          aria-controls="workspace-navigation"
          aria-expanded={navOpen}
          onClick={() => {
            closeSearch();
            onOpenNavigation();
          }}
        >
          <span aria-hidden="true">☰</span>
          <span className="visually-hidden">فتح مسارات العمل</span>
        </button>
      </div>
      <div id="workspace-search-panel" className="workspace-search-panel" hidden={!searchOpen}>
        <div className="workspace-search-results" aria-live="polite">
          {normalizedSearch ? searchResults.length ? (
            <>
              <p className="workspace-search-label">صفحات مطابقة</p>
              <ul>
                {searchResults.map((entry) => (
                  <li key={entry.href}>
                    <Link href={entry.href} aria-current={isCurrentWorkspacePath(pathname, entry.href) ? "page" : undefined} onClick={() => closeSearch()}>
                      <span>{entry.label}</span>
                      <small>{entry.context}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="workspace-search-empty">لا توجد صفحات مطابقة.</p> : <p className="workspace-search-empty">اكتب اسم الصفحة أو المساحة للبحث.</p>}
        </div>
      </div>
    </header>
  );
}

function WorkspaceNavigation({
  firstLinkRef,
  navRef,
  onClose,
  open,
  pathname
}: Readonly<{
  firstLinkRef: RefObject<HTMLAnchorElement | null>;
  navRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  pathname: string;
}>) {
  const { state } = useSession();
  const hasFinancePermission = state.kind === "authenticated" && state.identity.permissions?.includes("finance") === true;
  const visibleDestinations = hasFinancePermission ? workspaceDestinations : workspaceDestinations.filter((destination) => destination.href !== "/finance");
  return (
    <nav ref={navRef} id="workspace-navigation" className="workspace-nav" data-open={open} aria-label="تنقل مساحة المشغل">
      <div className="workspace-nav-header">
        <p className="workspace-nav-label">مساحة المشغل</p>
        <button type="button" className="workspace-nav-close" onClick={onClose} aria-label="إغلاق مسارات العمل">×</button>
      </div>
      {visibleDestinations.map((destination, index) => {
        const previous = visibleDestinations[index - 1];
        const current = isCurrentWorkspaceDestination(pathname, destination);
        const activeChild = currentWorkspaceChild(pathname, destination);
        return (
          <Fragment key={destination.href}>
            {index === 0 || destination.section !== previous?.section ? <p className="workspace-nav-label workspace-nav-section-label">{destination.section}</p> : null}
            <div className="workspace-nav-group">
              <Link
                ref={index === 0 ? firstLinkRef : undefined}
                className="workspace-nav-link"
                href={destination.href}
                aria-current={current ? (activeChild ? "location" : "page") : undefined}
                onClick={onClose}
              >
                {destination.label}
              </Link>
              {destination.children.length > 0 ? (
                <ul className="workspace-nav-children" aria-label={`مسارات ${destination.label}`}>
                  {destination.children.map((child) => {
                    const childCurrent = isCurrentWorkspacePath(pathname, child.href);
                    return (
                      <li key={child.href}>
                        <Link className="workspace-nav-child-link" href={child.href} aria-current={childCurrent ? "page" : undefined} onClick={onClose}>
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </Fragment>
        );
      })}
    </nav>
  );
}

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const navFirstLinkRef = useRef<HTMLAnchorElement>(null);
  const [localSignOut, setLocalSignOut] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { state, busy, restore, logout } = useSession();

  useEffect(() => { if (state.kind === "signed_out" && !state.notice && !localSignOut) router.replace("/"); }, [localSignOut, router, state]);
  useEffect(() => { if (pathname) mainRef.current?.focus(); }, [pathname]);
  useEffect(() => { if (pathname) setNavigationOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.classList.toggle("workspace-nav-open", navigationOpen);
    if (!navigationOpen) return () => document.body.classList.remove("workspace-nav-open");
    const frame = window.requestAnimationFrame(() => navFirstLinkRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove("workspace-nav-open");
    };
  }, [navigationOpen]);
  useEffect(() => {
    if (!navigationOpen) return;
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nav = navRef.current;
      if (!nav) return;
      const focusable = Array.from(nav.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !nav.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !nav.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [navigationOpen]);
  useEffect(() => {
    const background = [mainRef.current, document.querySelector<HTMLElement>(".workspace-header")].filter((element): element is HTMLElement => element !== null);
    for (const element of background) {
      element.inert = navigationOpen;
      if (navigationOpen) element.setAttribute("aria-hidden", "true");
      else element.removeAttribute("aria-hidden");
    }
    return () => {
      for (const element of background) {
        element.inert = false;
        element.removeAttribute("aria-hidden");
      }
    };
  }, [navigationOpen]);
  useEffect(() => {
    if (!navigationOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setNavigationOpen(false);
      window.requestAnimationFrame(() => navTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [navigationOpen]);

  const closeNavigation = () => {
    setNavigationOpen(false);
    window.requestAnimationFrame(() => navTriggerRef.current?.focus());
  };

  if (state.kind === "loading") return <LoadingState title="جارٍ فتح مساحة العمل" message="نتحقق من جلسة المشغل قبل عرض المساحة." />;
  if (state.kind === "unavailable") return <UnavailableState message={state.message} onRetry={() => void restore()} busy={busy} />;
  if (state.kind === "signed_out" && (state.notice || localSignOut)) return <IdentitySurface />;
  if (state.kind === "signed_out") return <LoadingState title="جارٍ الرجوع إلى بوابة الهوية" message="انتهت الجلسة المحلية أو لم تعد متاحة." />;

  return (
    <ControlShell className="workspace-app-shell" surface="workspace" footer={null} header={<WorkspaceHeader busy={busy} navOpen={navigationOpen} navTriggerRef={navTriggerRef} onLogout={() => { setLocalSignOut(true); void logout(); }} onOpenNavigation={() => setNavigationOpen(true)} pathname={pathname} />}>
      <a className="skip-link" href="#workspace-main">تخطي إلى المحتوى الرئيسي</a>
      <div className="workspace-layout">
        {navigationOpen ? <button type="button" className="workspace-nav-backdrop" aria-label="إغلاق مسارات العمل" onClick={closeNavigation} /> : null}
        <WorkspaceNavigation firstLinkRef={navFirstLinkRef} navRef={navRef} onClose={closeNavigation} open={navigationOpen} pathname={pathname} />
        <main ref={mainRef} id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
      </div>
    </ControlShell>
  );
}
