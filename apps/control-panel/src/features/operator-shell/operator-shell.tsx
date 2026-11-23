"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { findWorkspaceEntry, workspaceGroupLabels, workspaceRegistry, workspaceSubsections } from "../navigation/workspace-registry";
import { canEnterOperatorWorkspace, type OperatorPermission, visibleWorkspaceEntries } from "../session/operator-permissions";
import styles from "./operator-shell.module.css";

export default function OperatorShell({ children, verifiedGrants, originalOperator, appearanceControl }: Readonly<{
  children: ReactNode;
  // This is a display input for verified grants supplied by a server access boundary.
  verifiedGrants: readonly OperatorPermission[] | null;
  originalOperator: boolean;
  appearanceControl?: ReactNode;
}>) {
  const pathname = usePathname();
  const [signOutState, setSignOutState] = useState<"idle" | "pending" | "unconfirmed">("idle");
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
    if (signOutState !== "idle") return;
    // Conceal the previous actor's content before the first network round trip.
    setSignOutState("pending");
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      if (response.status === 204) {
        window.location.replace("/");
        return;
      }
    } catch { /* Unknown logout outcome: never claim Identity revoked the bearer. */ }
    setSignOutState("unconfirmed");
  }
  const navigationLink = ({ href, label }: { href: string; label: string }, selectedHref: string | null | undefined) => (
    <li key={href}>
      {/* Full document requests re-verify Identity when switching protected areas. */}
      <a href={href} aria-current={selectedHref === href ? "page" : undefined}>{label}</a>
    </li>
  );

  // Keep signed-out entry standalone and keep logout available to verified Operators.
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
      ) : <><aside className={hasWorkspace ? styles.sidebar : styles.publicBar}>
        <header className={styles.brand}>
          <strong>بثواني</strong>
          <span>لوحة التحكم</span>
        </header>
        <nav aria-label="التنقل الرئيسي" className={styles.navigation}>
          {hasWorkspace ? Object.entries(workspaceGroupLabels).map(([group, label]) => {
            const entries = workspaceRegistry.filter(entry => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} aria-label={label}>
                {entries.length > 1 ? <span className={styles.groupLabel}>{label}</span> : null}
                <ul>{entries.map(entry => permitted.some(item => item.href === entry.href)
                  ? navigationLink(entry, activeHref)
                  : <li key={entry.href}><span className={styles.lockedNavigationItem}
                      aria-disabled="true" title="يتطلب صلاحية من Identity">{entry.label} — غير مصرح</span></li>)}</ul>
              </section>
            );
          }) : <ul>{publicLinks.map(entry => navigationLink(entry, pathname))}</ul>}
        </nav>
        {verifiedGrants !== null && (
          <button type="button" className={styles.logout} onClick={signOut}>
            تسجيل الخروج
          </button>
        )}
      </aside>
      <div className={styles.mainColumn}>
        {hasWorkspace && (
          <section className={styles.topBar} aria-label="شريط أدوات لوحة التحكم">
            <div className={styles.pageContext}>
              <span>{activeEntry ? workspaceGroupLabels[activeEntry.group] : "مساحة إدارة بثواني"}</span>
              <strong>{activeEntry?.label ?? "مساحة العمل"}</strong>
            </div>
            <div className={styles.toolbarActions}>
              <span className={styles.sessionMark}>جلسة مشغّل موثّقة</span>
              {appearanceControl && <div className={styles.appearance}>{appearanceControl}</div>}
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
      </div></>}
    </div>
  );
}
