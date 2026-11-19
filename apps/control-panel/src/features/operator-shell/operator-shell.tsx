"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { findWorkspaceEntry, type WorkspaceGroup, workspaceRegistry } from "../navigation/workspace-registry";
import { canShowNavigation, type OperatorPermission } from "../session/operator-permissions";
import styles from "./operator-shell.module.css";

const publicLinks = [
  { href: "/", label: "تسجيل الدخول" },
  { href: "/health", label: "حالة الخدمة" },
];

const workspaceGroups: Readonly<Record<WorkspaceGroup, string>> = {
  home: "الرئيسية",
  operations: "العمليات",
  stores: "المتاجر",
  catalog: "الكتالوج",
  marketing: "التسويق والتصميم",
  finance: "المالية",
  administration: "الإدارة والموظفون",
  policies: "السياسات",
};

export default function OperatorShell({ children, verifiedGrants }: Readonly<{
  children: ReactNode;
  // This is a display input for verified grants supplied by a server access boundary.
  verifiedGrants?: readonly OperatorPermission[];
}>) {
  const pathname = usePathname();
  const [signOutState, setSignOutState] = useState<"idle" | "pending" | "unconfirmed">("idle");
  const permitted = verifiedGrants?.length
    ? workspaceRegistry.filter(({ href, permission }) => href === "/workspace" ||
        canShowNavigation(true, verifiedGrants, permission))
    : [];
  const activeHref = pathname && findWorkspaceEntry(pathname)?.href;

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
          {permitted.length > 0 ? Object.entries(workspaceGroups).map(([group, label]) => {
            const entries = permitted.filter(entry => entry.group === group);
            if (entries.length === 0) return null;
            return (
              <div key={group}>
                {entries.length > 1 ? <span className={styles.groupLabel}>{label}</span> : null}
                <ul>{entries.map(entry => navigationLink(entry, activeHref))}</ul>
              </div>
            );
          }) : <ul>{publicLinks.map(entry => navigationLink(entry, pathname))}</ul>}
        </nav>
        {permitted.length > 0 && (
          <button type="button" className={styles.logout} onClick={signOut}>
            تسجيل الخروج
          </button>
        )}
      </aside>
      <div className={styles.content}>{children}</div></>}
    </div>
  );
}
