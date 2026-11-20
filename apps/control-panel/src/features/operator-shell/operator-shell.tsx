"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { findWorkspaceEntry, workspaceGroupLabels, workspaceSubsections } from "../navigation/workspace-registry";
import { canEnterOperatorWorkspace, type OperatorPermission, operatorSectionTabs, visibleWorkspaceEntries } from "../session/operator-permissions";
import styles from "./operator-shell.module.css";

export default function OperatorShell({ children, verifiedGrants }: Readonly<{
  children: ReactNode;
  // This is a display input for verified grants supplied by a server access boundary.
  verifiedGrants: readonly OperatorPermission[] | null;
}>) {
  const pathname = usePathname();
  const [signOutState, setSignOutState] = useState<"idle" | "pending" | "unconfirmed">("idle");
  const permitted = visibleWorkspaceEntries(verifiedGrants ?? []);
  const sectionTabs = operatorSectionTabs(verifiedGrants ?? []);
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

  return (
    <div className={styles.shell}>
      {signOutState !== "idle" ? (
        <main className={styles.signOutStatus} role="status">
          <h1>تسجيل الخروج</h1>
          <p>{signOutState === "pending"
            ? "جارٍ طلب إبطال الجلسة لدى Identity…"
            : "لم يتم تأكيد إبطال الجلسة لدى Identity. أُخفيت محتويات مساحة العمل؛ لا تعتبر الجلسة منتهية على الخادم."}</p>
          {signOutState === "unconfirmed" && <a href="/">العودة إلى صفحة الدخول</a>}
        </main>
      ) : <><aside className={styles.sidebar}>
        <header className={styles.brand}>لوحة تحكم بثواني</header>
        <nav aria-label="التنقل الرئيسي" className={styles.navigation}>
          {permitted.length > 0 ? Object.entries(workspaceGroupLabels).map(([group, label]) => {
            const entries = permitted.filter(entry => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <div key={group}>
                {entries.length > 1 ? <span className={styles.groupLabel}>{label}</span> : null}
                <ul>{entries.map(entry => navigationLink(entry, activeHref))}</ul>
              </div>
            );
          }) : <>
            <ul>{publicLinks.map(entry => navigationLink(entry, pathname))}</ul>
            <section className={styles.lockedSections} aria-label="الأقسام الرئيسية (تتطلب تسجيل الدخول)">
              <h2>الأقسام الرئيسية</h2>
              <ul>
                {Object.entries(workspaceGroupLabels).filter(([group]) => group !== "home").map(([group, label]) => (
                  <li key={group}>{label}</li>
                ))}
              </ul>
              <p>روابط الأقسام تظهر بعد التحقق من جلسة المشغّل وصلاحياته.</p>
            </section>
          </>}
        </nav>
        {verifiedGrants !== null && (
          <button type="button" className={styles.logout} onClick={signOut}>
            تسجيل الخروج
          </button>
        )}
      </aside>
      <div className={styles.content}>
        {sectionTabs.length > 0 && (
          <header className={styles.workspaceBar}>
            <span className={styles.currentSection}>{activeEntry?.label ?? "لوحة تحكم بثواني"}</span>
            <nav aria-label="تبويبات الأقسام" className={styles.sectionTabs}>
              <ul>{sectionTabs.map((tab) => (
                <li key={tab.group}>
                  <a href={tab.href} aria-current={activeEntry?.group === tab.group ? "page" : undefined}>
                    {workspaceGroupLabels[tab.group]}
                  </a>
                </li>
              ))}</ul>
            </nav>
            {subsectionLinks.length > 0 && activeEntry && (
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
            )}
          </header>
        )}
        {children}
      </div></>}
    </div>
  );
}
