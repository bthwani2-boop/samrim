"use client";

import type { ActorIdentity } from "@bthwani/identity";
import { Breadcrumb, type BreadcrumbProps, Menu, type MenuProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { IdentitySurface } from "../../src/features/access/identity-surface";
import { currentWorkspaceChild, currentWorkspaceDestination, dynamicWorkspaceRouteLabel, isCurrentWorkspaceDestination, workspaceCatalogResources, workspaceDestinations, workspaceSearchEntries } from "../../src/navigation/workspace-registry";
import { useSession } from "../../src/session/session-provider";
import { OperatorAccountDrawer } from "../../src/shell/operator-account-drawer";
import { ControlShell, LoadingState, UnavailableState } from "../../src/shell/public-shell";
import { WorkspaceIcon } from "../../src/shell/workspace-icon";
import { WorkspaceGlobalSearch } from "../../src/shell/workspace-global-search";
import { StoreCatalogWebMCPTools } from "../../src/features/webmcp/store-catalog-webmcp-tools";
import { WorkspaceEntryWebMCPTools } from "../../src/features/webmcp/workspace-entry-tools";

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
  const items: NonNullable<BreadcrumbProps["items"]> = [];

  if (current.href === "/workspace") {
    items.push({ title: <span aria-current="page">{current.label}</span> });
  } else {
    items.push({ title: <Link href="/workspace">الرئيسية</Link> });
    items.push({ title: child
      ? <Link href={current.href}>{current.label}</Link>
      : <span aria-current="page">{current.label}</span> });
    if (showParentChild && parentChild) items.push({ title: <Link href={parentChild.href}>{parentChild.label}</Link> });
    if (child) items.push({ title: <span aria-current="page">{detailLabel || child.label}</span> });
  }

  return (
    <div className="workspace-breadcrumbs" role="navigation" aria-label="مسار الصفحة">
      <Breadcrumb items={items} />
    </div>
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const searchEntries = identity
    ? workspaceSearchEntries.filter((entry) => canOpenWorkspaceRoute(identity, entry.href))
    : [];
  useEffect(() => {
    if (pathname || navOpen) setAccountOpen(false);
  }, [pathname, navOpen]);

  return (
    <header className="workspace-header">
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
        <WorkspaceGlobalSearch entries={searchEntries} identity={identity} pathname={pathname} navigationOpen={navOpen} accountOpen={accountOpen} />
        <button
          ref={accountTriggerRef}
          type="button"
          className="workspace-account-trigger"
          aria-label="الملف الشخصي"
          title="الملف الشخصي"
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
          aria-controls="operator-account-drawer"
          onClick={() => setAccountOpen((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" /></svg>
        </button>
        <OperatorAccountDrawer
          key={identity?.subject ?? "unknown"}
          identity={identity}
          open={accountOpen}
          busy={busy}
          onLogout={onLogout}
          onClose={() => {
            setAccountOpen(false);
            window.requestAnimationFrame(() => accountTriggerRef.current?.focus());
          }}
        />

        <button
          ref={navTriggerRef}
          className="workspace-nav-toggle"
          type="button"
          aria-controls="workspace-navigation"
          aria-expanded={navOpen}
          onClick={onOpenNavigation}
        >
          <span aria-hidden="true">☰</span>
          <span className="visually-hidden">فتح مسارات العمل</span>
        </button>
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
  const activeChild = currentWorkspaceChild(pathname, activeDestination);
  const activeKey = !open && compact ? activeDestination.href : activeChild && activeChild.href !== activeDestination.href
    ? activeChild.href
    : activeDestination.href;
  const items: MenuProps["items"] = visibleDestinations.flatMap((destination, index) => {
    const current = activeDestination.href === destination.href;
    const childItems = current && (!compact || open) ? destination.children
      .filter((child) => child.showInWorkspaceNavigation !== false && child.href !== destination.href)
      .map((child) => ({
        key: child.href,
        className: "workspace-nav-child-item",
        label: <Link href={child.href} title={child.label} aria-current={activeKey === child.href ? "page" : undefined} onClick={onClose}>{child.label}</Link>,
      })) : [];
    return [{
      key: destination.href,
      icon: <WorkspaceIcon href={destination.href} />,
      label: <Link ref={index === 0 ? firstLinkRef : undefined} href={destination.href} title={destination.label} aria-label={destination.label} aria-current={current && activeKey === destination.href ? "page" : undefined} onClick={onClose}>{destination.label}</Link>,
    }, ...childItems];
  });

  return (
    <nav ref={navRef} id="workspace-navigation" className="workspace-nav" data-open={open} aria-label="تنقل مساحة المشغل">
      <div className="workspace-nav-header">
        <p className="workspace-nav-label">مساحة المشغل</p>
        <button type="button" className="workspace-nav-compact-toggle" onClick={onToggleDensity} aria-label={dense ? "عرض الصفوف المريح" : "تكثيف صفوف الجداول"} title={dense ? "عرض الصفوف المريح" : "تكثيف صفوف الجداول"} aria-pressed={dense}>≡</button>
        <button type="button" className="workspace-nav-compact-toggle" onClick={onToggleCompact} aria-label={compact ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"} title={compact ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"} aria-pressed={compact}><span aria-hidden="true">{compact ? "»" : "«"}</span></button>
        <button type="button" className="workspace-nav-close" onClick={onClose} aria-label="إغلاق مسارات العمل">×</button>
      </div>
      <Menu
        mode="inline"
        inlineCollapsed={compact && !open}
        selectedKeys={[activeKey]}
        items={items}
        className="workspace-nav-menu"
      />
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
      <StoreCatalogWebMCPTools enabled={state.identity.role === "operator" && state.identity.permissions?.includes("catalog") === true} />
      <WorkspaceEntryWebMCPTools identity={state.identity} />
      <a className="skip-link" href="#workspace-main">تخطي إلى المحتوى الرئيسي</a>
      <div className="workspace-layout" data-nav-compact={navigationCompact ? "true" : "false"} data-table-density={tableDense ? "compact" : "comfortable"}>
        {navigationOpen ? <button type="button" className="workspace-nav-backdrop" aria-label="إغلاق مسارات العمل" onClick={closeNavigation} /> : null}
        <WorkspaceNavigation firstLinkRef={navFirstLinkRef} navRef={navRef} onClose={closeNavigation} open={navigationOpen} pathname={pathname} compact={navigationCompact} onToggleCompact={toggleNavigationCompact} dense={tableDense} onToggleDensity={toggleTableDensity} />
        <main key={state.identity.subject} ref={mainRef} id="workspace-main" className="workspace-main" data-workspace-section={pathname?.split("/")[1] || "workspace"} tabIndex={-1}>
          {destinationAccessGranted ? children : <section className="collection-state" role="status"><strong>الوصول إلى هذه المساحة غير مفعّل</strong><p>تحتاج إلى صلاحية النطاق المناسبة من إدارة صلاحيات المشغّلين.</p><Link className="button button-secondary" href="/workspace">العودة إلى الرئيسية</Link></section>}
        </main>
      </div>
    </ControlShell>
  );
}
