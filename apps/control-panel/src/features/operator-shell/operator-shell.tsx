"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { findWorkspaceEntry, workspaceGroupLabels, workspaceRegistry, workspaceSubsections } from "../navigation/workspace-registry";
import { canEnterOperatorWorkspace, type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";
import { notifyOperatorSessionChanged, subscribeOperatorSessionChanged, withOperatorBrowserSession } from "../session/operator-browser-session";
import { OperatorIcon, type OperatorIconName } from "./operator-icon";
import OperatorNavigationSearch from "./operator-navigation-search";
import styles from "./operator-shell.module.css";

const groupIcons: Record<string, OperatorIconName> = {
  home: "home",
  operations: "operations",
  stores: "store",
  catalog: "catalog",
  marketing: "marketing",
  finance: "finance",
  administration: "people",
  policies: "policy",
};

const entryIcons: Record<string, OperatorIconName> = {
  "/workspace": "home",
  "/operations": "operations",
  "/captains": "captain",
  "/merchants": "store",
  "/catalog": "catalog",
  "/marketing": "marketing",
  "/studio": "studio",
  "/customers": "people",
  "/finance": "finance",
  "/hr": "people",
  "/access": "shield",
  "/notifications": "bell",
  "/policies": "policy",
};

export default function OperatorShell({ children, verifiedGrants, originalOperator, verifiedActorId, verifiedExpiresAt, appearanceControl }: Readonly<{
  children: ReactNode;
  // The backend gates data and actions independently; links are only presentation hints.
  verifiedGrants: readonly OperatorPermission[] | null;
  originalOperator: boolean;
  verifiedActorId: string | null;
  verifiedExpiresAt: string | null;
  appearanceControl?: ReactNode;
}>) {
  const pathname = usePathname();
  const [signOutState, setSignOutState] = useState<"idle" | "pending" | "unconfirmed">("idle");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionVisible, setSessionVisible] = useState(true);
  const [sessionInvalidated, setSessionInvalidated] = useState(false);
  const signingOut = useRef(false);
  useEffect(() => {
    if (!verifiedActorId || !verifiedExpiresAt || !verifiedGrants || signOutState !== "idle") return;
    let active = true;
    let pending = false;
    let changedWhilePending = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const conceal = () => { if (active) setSessionVisible(false); };
    const foreground = () => document.visibilityState !== "hidden";
    const arm = (value: string) => {
      clearTimeout(expiry);
      const remaining = Date.parse(value) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) { conceal(); return false; }
      expiry = setTimeout(conceal, Math.min(remaining, 2147483647));
      return true;
    };
    async function check() {
      if (!active || signingOut.current || pending || !foreground()) return;
      pending = true;
      try {
        const decision = await withOperatorBrowserSession(async () => {
          if (!active || signingOut.current) throw new Error("Obsolete session check");
          const reply = await fetch("/api/auth/session", {
            method: "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(45_000),
          });
          if (reply.status === 401) return null;
          if (!reply.ok) throw new Error("Identity unavailable");
          return await reply.json() as { authenticated?: boolean; role?: string; actorId?: string; grants?: unknown; originalOperator?: boolean; sessionExpiresAt?: string };
        });
        if (!active || signingOut.current) return;
        const grants = decision?.grants;
        if (decision?.authenticated !== true || decision.role !== "operator" ||
            decision.actorId !== verifiedActorId || decision.originalOperator !== originalOperator || !Array.isArray(grants) ||
            !verifiedGrants || grants.length !== verifiedGrants.length ||
            !verifiedGrants.every(grant => grants.includes(grant))) {
          conceal();
          setSessionInvalidated(true);
          active = false;
          window.location.replace("/");
          return;
        }
        if (typeof decision.sessionExpiresAt !== "string" || !arm(decision.sessionExpiresAt)) return;
        if (!changedWhilePending && foreground()) setSessionVisible(true);
      } catch { conceal(); }
      finally {
        pending = false;
        if (changedWhilePending) {
          changedWhilePending = false;
          if (active) void check();
        }
      }
    }
    const recheck = () => {
      conceal();
      if (pending) changedWhilePending = true;
      else void check();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else recheck();
    };
    arm(verifiedExpiresAt);
    if (document.visibilityState === "hidden") conceal();
    else void check();
    const timer = setInterval(() => void check(), 30_000);
    const unsubscribe = subscribeOperatorSessionChanged(recheck);
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("pagehide", conceal);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearTimeout(expiry);
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("pagehide", conceal);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [verifiedActorId, verifiedExpiresAt, verifiedGrants, originalOperator, signOutState]);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const permitted = visibleWorkspaceEntries(verifiedGrants ?? [], originalOperator);
  const hasWorkspace = permitted.length > 0;
  const publicLinks = [
    { href: "/", label: verifiedGrants === null ? "دخول المشغّل" : "الوصول إلى اللوحة" },
    { href: "/health", label: "حالة الواجهة" },
  ];
  const activeEntry = pathname ? findWorkspaceEntry(pathname) : null;
  const activeHref = activeEntry?.href;
  const subsectionLinks = workspaceSubsections.filter(item => activeHref === item.parent && canEnterOperatorWorkspace(verifiedGrants ?? [], item.href));

  async function signOut() {
    if (signOutState !== "idle" || signingOut.current || !verifiedActorId) return;
    signingOut.current = true;
    setSignOutState("pending");
    try {
      const response = await withOperatorBrowserSession(async () => {
        const current = await fetch("/api/auth/session", {
          method: "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(45_000),
        });
        if (current.status === 401) return null;
        if (!current.ok) throw new Error("Identity unavailable");
        const actor = await current.json() as { authenticated?: boolean; role?: string; actorId?: string };
        // Never let an old tab sign out the newly signed-in different actor.
        if (actor.authenticated !== true || actor.role !== "operator" || actor.actorId !== verifiedActorId) return null;
        return fetch("/api/auth/session", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(45_000),
        });
      });
      if (response === null || response.status === 204) {
        notifyOperatorSessionChanged();
        window.location.replace("/");
        return;
      }
    } catch { /* Unknown revocation outcome: keep the previous actor concealed. */ }
    setSignOutState("unconfirmed");
  }
  const navigationLink = ({ href, label }: { href: string; label: string }, selectedHref: string | null | undefined) => (
    <li key={href}>
      {/* Full document requests re-verify Identity when switching protected areas. */}
      <a href={href} aria-current={selectedHref === href ? "page" : undefined}
        onClick={() => setSidebarOpen(false)}>
        <OperatorIcon name={entryIcons[href] ?? "layers"} />
        <span>{label}</span>
      </a>
    </li>
  );

  if (sessionInvalidated) return <main className={styles.signOutStatus} role="status">
    تغيّرت جلسة المشغّل أو صلاحياته؛ جارٍ إعادة التحقق.
    <a href="/">العودة إلى صفحة الدخول</a>
  </main>;
  if (pathname === "/" && verifiedGrants === null && signOutState === "idle") {
    return <div className={styles.loginOnly}>{children}</div>;
  }

  return (
    <div className={hasWorkspace ? styles.shell : `${styles.shell} ${styles.publicShell}`}>
      <a className={styles.skipLink} href="#operator-content">تخطي إلى المحتوى الرئيسي</a>
      {signOutState !== "idle" ? (
        <main className={styles.signOutStatus} role="status" id="operator-content" tabIndex={-1}>
          <h1>تسجيل الخروج</h1>
          <p>{signOutState === "pending"
            ? "جارٍ طلب إبطال الجلسة لدى Identity…"
            : "لم يتم تأكيد إبطال الجلسة لدى Identity. أُخفيت محتويات مساحة العمل؛ لا تعتبر الجلسة منتهية على الخادم."}</p>
          {signOutState === "unconfirmed" && <a href="/">العودة إلى صفحة الدخول</a>}
        </main>
      ) : <>
        {!sessionVisible && verifiedActorId && <main role="status" className={styles.signOutStatus} style={{ gridColumn: "1 / -1" }}>
          جارٍ التحقق من جلسة المشغّل لدى Identity. ستعود مساحة العمل بعد تأكيد الصلاحيات.
        </main>}
        {sessionVisible && hasWorkspace && sidebarOpen && <button type="button" aria-label="إغلاق القائمة الجانبية"
          className={styles.mobileScrim} onClick={() => setSidebarOpen(false)} />}
        <aside id="operator-sidebar" hidden={!sessionVisible} inert={!sessionVisible} style={!sessionVisible ? { display: "none" } : undefined} className={hasWorkspace ? `${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}` : styles.publicBar}>
          <header className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">ب</span>
            <span className={styles.brandWords}><strong>بثواني</strong><small>لوحة التحكم</small></span>
          </header>
          <nav aria-label="التنقل الرئيسي" className={styles.navigation}>
            {hasWorkspace ? Object.entries(workspaceGroupLabels).map(([group, label]) => {
              const entries = workspaceRegistry.filter(entry => entry.group === group);
              if (!entries.length) return null;
              const open = collapsed[group] !== true;
              return (
                <section key={group} aria-label={label} className={styles.navGroup}>
                  {entries.length > 1 ? (
                    <button type="button" className={styles.groupToggle} aria-expanded={open}
                      onClick={() => setCollapsed(current => ({ ...current, [group]: !(current[group] === true) }))}>
                      <span>{label}</span>
                      <OperatorIcon name="chevron" className={open ? styles.chevronOpen : styles.chevronClosed} />
                    </button>
                  ) : null}
                  {open && <ul>{entries.map(entry => permitted.some(item => item.href === entry.href)
                    ? navigationLink(entry, activeHref)
                    : <li key={entry.href}><span className={styles.lockedNavigationItem}
                        aria-disabled="true" title="يتطلب صلاحية من Identity">
                        <OperatorIcon name={entryIcons[entry.href] ?? groupIcons[group] ?? "layers"} />
                        <span>{entry.label} — غير مصرح</span>
                      </span></li>)}</ul>}
                </section>
              );
            }) : <ul>{publicLinks.map(entry => navigationLink(entry, pathname))}</ul>}
          </nav>
          {verifiedGrants !== null && (
            <div className={styles.sidebarFooter}>
              <button type="button" className={styles.logout} onClick={signOut}>
                <OperatorIcon name="arrow" /><span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </aside>
        <div className={styles.mainColumn} hidden={!sessionVisible} inert={!sessionVisible} style={!sessionVisible ? { display: "none" } : undefined}>
          {hasWorkspace && (
            <section className={styles.topBar} aria-label="شريط أدوات لوحة التحكم">
              <div className={styles.topbarLeading}>
                <button ref={menuButton} type="button" aria-label="فتح القائمة الجانبية" aria-controls="operator-sidebar" aria-expanded={sidebarOpen}
                  className={styles.mobileMenu} onClick={() => setSidebarOpen(!sidebarOpen)}>
                  <OperatorIcon name="menu" />
                </button>
                <div className={styles.pageContext}>
                  <span>{activeEntry ? workspaceGroupLabels[activeEntry.group] : "مساحة إدارة بثواني"}</span>
                  <strong>{activeEntry?.label ?? "مساحة العمل"}</strong>
                </div>
              </div>
              <OperatorNavigationSearch entries={permitted} />
              <div className={styles.toolbarActions}>
                <a href="/health" className={styles.headerIcon} aria-label="مساعدة وحالة الواجهة" title="مساعدة وحالة الواجهة">
                  <OperatorIcon name="help" />
                </a>
                <button type="button" className={styles.headerIcon} disabled aria-label="الإشعارات غير مفعّلة لهذا الدور"
                  title="الإشعارات غير مفعّلة لهذا الدور"><OperatorIcon name="bell" /></button>
                <details className={styles.operatorMenu}>
                  <summary aria-label="حساب المشغّل والمظهر">
                    <span className={styles.avatar}><OperatorIcon name="people" /></span>
                    <span className={styles.operatorInfo}><strong>مشغّل النظام</strong><small>جلسة موثّقة</small></span>
                    <OperatorIcon name="chevron" />
                  </summary>
                  <div className={styles.operatorMenuContent}>
                    <span className={styles.menuCaption}>مظهر لوحة التحكم</span>
                    {appearanceControl && <div className={styles.appearance}>{appearanceControl}</div>}
                    <button className={styles.accountLogout} type="button" onClick={signOut}>تسجيل الخروج</button>
                  </div>
                </details>
              </div>
            </section>
          )}
          <div className={styles.content} id="operator-content" tabIndex={-1}>
            {subsectionLinks.length > 0 && activeEntry && (
              <header className={styles.workspaceBar}>
                <nav aria-label="تبويبات الوظائف" className={styles.subsectionTabs}>
                  <ul>
                    <li><a href={activeEntry.href} aria-current={pathname === activeEntry.href ? "page" : undefined}>نظرة عامة</a></li>
                    {subsectionLinks.map(item => (
                      <li key={item.href}>
                        <a href={item.href} aria-current={pathname === item.href || pathname?.startsWith(`${item.href}/`) ? "page" : undefined}>
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </header>
            )}
            {children}
          </div>
        </div>
      </>}
    </div>
  );
}
