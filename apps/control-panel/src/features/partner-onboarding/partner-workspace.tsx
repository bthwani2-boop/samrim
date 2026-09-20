"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";

export type PartnerWorkspaceResource = "queue" | "cities" | "detail" | "new";

export function PartnerOperatorBoundary({ children }: { children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return (
      <section className="state-content workspace-restricted" aria-labelledby="partners-restricted-title">
        <div className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">صلاحية غير متاحة</p>
          <h1 id="partners-restricted-title">الشركاء والمتاجر مقصورة على مشغلي لوحة التحكم</h1>
          <p className="muted">هذه المساحة لا تمنح صلاحيات إضافية خارج دور Identity الموثق.</p>
        </div>
      </section>
    );
  }

  return children;
}

export function PartnerWorkspaceLinks({ active }: { active: PartnerWorkspaceResource }) {
  return (
    <nav className="managed-status managed-status-info" aria-label="مساحات الشركاء والمتاجر">
      <strong>مساحات الشركاء والمتاجر</strong>
      <ul>
        <li><Link href="/partners" aria-current={active === "queue" ? "page" : undefined}>طابور حالات الانضمام</Link></li>
        <li><Link href="/partners/new" aria-current={active === "new" ? "page" : undefined}>إضافة شريك من لوحة التحكم</Link></li>
        <li><Link href="/partners/service-cities" aria-current={active === "cities" ? "page" : undefined}>مدن الخدمة</Link></li>
      </ul>
    </nav>
  );
}
