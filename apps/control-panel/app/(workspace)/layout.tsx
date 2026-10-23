"use client";

import type { ActorIdentity } from "@bthwani/identity";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { IdentitySurface } from "../../src/features/access/identity-surface";
import { currentWorkspaceChild, currentWorkspaceDestination, dynamicWorkspaceRouteLabel, isCurrentWorkspaceDestination, isCurrentWorkspacePath, workspaceCatalogResources, workspaceDestinations, workspaceSearchEntries } from "../../src/navigation/workspace-registry";
import { identityFetch } from "../../src/session/identity-fetch";
import { operatorWorkspacePermissions } from "../../src/session/operator-permissions";
import { useSession } from "../../src/session/session-provider";
import { AppearanceControl } from "../../src/shell/appearance-control";
import { ControlShell, LoadingState, UnavailableState } from "../../src/shell/public-shell";
import { WorkspaceIcon } from "../../src/shell/workspace-icon";
import { WorkspaceRecordSearch } from "../../src/shell/workspace-record-search";

function currentChild(pathname: string, destination: (typeof workspaceDestinations)[number]) {
  const child = currentWorkspaceChild(pathname, destination);
  if (child) return child;
  const label = dynamicWorkspaceRouteLabel(pathname);
  return label ? { href: pathname, label } : null;
}

function canOpenWorkspaceDestination(identity: ActorIdentity, destination: (typeof workspaceDestinations)[number]) {
  if (destination.initialOperatorAdminOnly && !identity.canManageOperatorPermissions) return false;
  return !destination.permission || identity.permissions?.includes(destination.permission) === true;
}

function canOpenWorkspaceRoute(identity: ActorIdentity, href: string) {
  // The shared recovery page serves partners as well as catalog operators.
  if (href === "/catalog/trash" && identity.permissions?.includes("partners")) return true;
  const destination = workspaceDestinations.find((candidate) => isCurrentWorkspaceDestination(href, candidate));
  return !destination || canOpenWorkspaceDestination(identity, destination);
}

function workspaceNavigationContext(pathname: string, identity: ActorIdentity | null) {
  // A partners-only operator enters the shared recovery workspace through Partners.
  const partnersRecovery = pathname === "/catalog/trash"
    && identity?.permissions?.includes("partners") === true
    && !identity.permissions?.includes("catalog");
  const destination = partnersRecovery
    ? (workspaceDestinations.find((entry) => entry.href === "/partners") ?? currentWorkspaceDestination(pathname))
    : currentWorkspaceDestination(pathname);
  const child = partnersRecovery
    ? { href: pathname, label: workspaceCatalogResources.find((entry) => entry.key === "trash")?.label ?? "سلة المحذوفات" }
    : currentChild(pathname, destination);
  return { destination, child };
}

function WorkspaceBreadcrumbs({ pathname, identity }: Readonly<{ pathname: string; identity: ActorIdentity | null }>) {
  const { destination: current, child } = workspaceNavigationContext(pathname, identity);
  const parentChild = currentWorkspaceChild(pathname, current);
  const detailLabel = dynamicWorkspaceRouteLabel(pathname);
  const showParentChild = Boolean(detailLabel && parentChild && parentChild.href !== current.href && parentChild.href !== pathname);
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
            {showParentChild && parentChild ? <li><Link href={parentChild.href}>{parentChild.label}</Link></li> : null}
            {child ? <li aria-current="page"><span>{detailLabel || child.label}</span></li> : null}
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
  const permissionLabels = operatorWorkspacePermissions.filter(({ key }) => identity.permissions?.includes(key) === true).map(({ label }) => label);

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
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" />
          </svg>
        </span>
        <div className="operator-profile-copy">
          <p className="operator-profile-title">{identity.role === "operator" ? "حساب المشغّل" : "حساب معتمد"}</p>
          <p>لوحة التحكم</p>
        </div>
      </div>
      <p className="operator-profile-status">جلسة نشطة</p>
      <dl className="operator-profile-details">
        <div><dt>اسم المشغّل</dt><dd>مشغّل المنصة</dd></div>
        <div><dt>رقم الهاتف</dt><dd aria-live="polite"><bdi dir="ltr">{phoneLoading ? "جارٍ تحميل الرقم…" : phoneUnavailable ? "تعذر تحميله" : phone ?? "افتح الحساب لعرض الرقم"}</bdi></dd></div>
        <div><dt>الصلاحيات الممنوحة</dt><dd>{permissionLabels.length > 0 ? permissionLabels.join("، ") : "لا توجد صلاحيات نطاق ممنوحة"}</dd></div>
        {identity.canManageOperatorPermissions ? <div><dt>إدارة صلاحيات المشغّلين</dt><dd>متاحة</dd></div> : null}
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
  const searchEntries = identity
    ? workspaceSearchEntries.filter((entry) => canOpenWorkspaceRoute(identity, entry.href))
    : [];
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
        <WorkspaceBreadcrumbs pathname={pathname} identity={identity} />
      </div>
      <div className="workspace-header-tools">
        <Link className="workspace-notifications-link" href="/notifications" aria-label="الإشعارات" title="الإشعارات" aria-current={pathname === "/notifications" ? "page" : undefined}>
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
          <span className="visually-hidden">الإشعارات</span>
        </Link>
        {identity?.permissions?.some((permission) => permission === "catalog" || permission === "partners") ? (
          <Link className="workspace-trash-link" href="/catalog/trash" aria-label="فتح سلة المحذوفات" title="فتح سلة المحذوفات" aria-current={pathname === "/catalog/trash" ? "page" : undefined}>
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
              <g className="workspace-trash-restore-arrow">
                <path d="M8.3 13.5a4.5 4.5 0 1 1 1.6 3.5" />
                <path d="M7 10.5V14h3.5" />
              </g>
            </svg>
            <span className="visually-hidden">سلة المحذوفات</span>
          </Link>
        ) : null}
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
            <form className="workspace-search-form" noValidate onSubmit={submitSearch}>
              <label className="visually-hidden" htmlFor="workspace-search-input">البحث في صفحات لوحة التحكم</label>
              <input
                ref={searchInputRef}
                id="workspace-search-input"
                type="search"
                autoComplete="off"
                placeholder="ابحث عن صفحة أو سجل"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery ? <button type="button" className="workspace-search-close" aria-label="مسح نص البحث" onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}>×</button> : null}
              <button type="button" className="workspace-search-close" aria-label="إغلاق البحث" onClick={() => closeSearch(true)}>×</button>
            </form>
          ) : null}
        </search>
        <details className="account-menu" onToggle={(event) => setAccountMenuOpen(event.currentTarget.open)}>
          <summary aria-label="الحساب" title="الحساب">
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" /></svg>
            <span className="visually-hidden">الحساب</span>
          </summary>
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
          {searchOpen && normalizedSearch && identity ? <WorkspaceRecordSearch key={identity.subject} query={searchQuery} identity={identity} onNavigate={() => closeSearch()} /> : null}
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
  pathname,
  compact,
  onToggleCompact,
  dense,
  onToggleDensity
}: Readonly<{
  firstLinkRef: RefObject<HTMLAnchorElement | null>;
  navRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  pathname: string;
  compact: boolean;
  onToggleCompact: () => void;
  dense: boolean;
  onToggleDensity: () => void;
}>) {
  const { state } = useSession();
  const visibleDestinations = state.kind === "authenticated"
    ? workspaceDestinations.filter((destination) => destination.showInWorkspaceNavigation !== false && canOpenWorkspaceDestination(state.identity, destination))
    : [];
  const activeDestination = workspaceNavigationContext(pathname, state.kind === "authenticated" ? state.identity : null).destination;
  return (
    <nav ref={navRef} id="workspace-navigation" className="workspace-nav" data-open={open} aria-label="تنقل مساحة المشغل">
      <div className="workspace-nav-header">
        <p className="workspace-nav-label">مساحة المشغل</p>
        <button type="button" className="workspace-nav-compact-toggle" onClick={onToggleDensity} aria-label={dense ? "عرض الصفوف المريح" : "تكثيف صفوف الجداول"} title={dense ? "عرض الصفوف المريح" : "تكثيف صفوف الجداول"} aria-pressed={dense}>≡</button>
        <button type="button" className="workspace-nav-compact-toggle" onClick={onToggleCompact} aria-label={compact ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"} title={compact ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"} aria-pressed={compact}><span aria-hidden="true">{compact ? "»" : "«"}</span></button>
        <button type="button" className="workspace-nav-close" onClick={onClose} aria-label="إغلاق مسارات العمل">×</button>
      </div>
      {visibleDestinations.map((destination, index) => {
        const current = activeDestination.href === destination.href;
        const activeChild = currentWorkspaceChild(pathname, destination);
        return (
            <div className="workspace-nav-group" key={destination.href}>
              <Link
                ref={index === 0 ? firstLinkRef : undefined}
                className="workspace-nav-link"
                href={destination.href}
                title={destination.label}
                aria-label={destination.label}
                aria-current={current ? (activeChild || pathname !== destination.href ? "location" : "page") : undefined}
                onClick={onClose}
              >
                <WorkspaceIcon href={destination.href} /><span className="workspace-nav-link-label">{destination.label}</span>
              </Link>
              {current && destination.children.length > 0 ? (
                <ul className="workspace-nav-children" aria-label={`مسارات ${destination.label}`}>
                  {destination.children.filter((child) => child.showInWorkspaceNavigation !== false).map((child) => {
                    const childCurrent = activeChild?.href === child.href;
                    return (
                      <li key={child.href}>
                        <Link className="workspace-nav-child-link" href={child.href} title={child.label} aria-label={child.label} aria-current={childCurrent ? "page" : undefined} onClick={onClose}>
                          <span className="workspace-nav-child-compact-marker" aria-hidden="true"><WorkspaceIcon href={child.href} /></span><span className="workspace-nav-child-label">{child.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
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
  const [navigationCompact, setNavigationCompact] = useState(false);
  const [tableDense, setTableDense] = useState(false);
  useEffect(() => {
    try { setNavigationCompact(window.localStorage.getItem("bthwani-operator-compact-nav") === "true"); } catch { /* storage unavailable */ }
    try { setTableDense(window.localStorage.getItem("bthwani-operator-dense-tables") === "true"); } catch { /* storage unavailable */ }
  }, []);
  const toggleTableDensity = () => setTableDense((current) => {
    const next = !current;
    try { window.localStorage.setItem("bthwani-operator-dense-tables", String(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const toggleNavigationCompact = () => setNavigationCompact((current) => {
    const next = !current;
    try { window.localStorage.setItem("bthwani-operator-compact-nav", String(next)); } catch { /* storage unavailable */ }
    return next;
  });
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

  const destinationAccessGranted = canOpenWorkspaceRoute(state.identity, pathname);

  return (
    <ControlShell className="workspace-app-shell" surface="workspace" footer={null} header={<WorkspaceHeader busy={busy} navOpen={navigationOpen} navTriggerRef={navTriggerRef} onLogout={() => { setLocalSignOut(true); void logout(); }} onOpenNavigation={() => setNavigationOpen(true)} pathname={pathname} />}>
      <a className="skip-link" href="#workspace-main">تخطي إلى المحتوى الرئيسي</a>
      <div className="workspace-layout" data-nav-compact={navigationCompact ? "true" : "false"} data-table-density={tableDense ? "compact" : "comfortable"}>
        {navigationOpen ? <button type="button" className="workspace-nav-backdrop" aria-label="إغلاق مسارات العمل" onClick={closeNavigation} /> : null}
        <WorkspaceNavigation firstLinkRef={navFirstLinkRef} navRef={navRef} onClose={closeNavigation} open={navigationOpen} pathname={pathname} compact={navigationCompact} onToggleCompact={toggleNavigationCompact} dense={tableDense} onToggleDensity={toggleTableDensity} />
        <main ref={mainRef} id="workspace-main" className="workspace-main" data-workspace-section={pathname?.split("/")[1] || "workspace"} tabIndex={-1}>
          {destinationAccessGranted ? children : <section className="collection-state" role="status"><strong>الوصول إلى هذه المساحة غير مفعّل</strong><p>تحتاج إلى صلاحية النطاق المناسبة من إدارة صلاحيات المشغّلين.</p><Link className="button button-secondary" href="/workspace">العودة إلى الرئيسية</Link></section>}
        </main>
      </div>
    </ControlShell>
  );
}
