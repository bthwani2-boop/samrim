"use client";

import type { ReactNode } from "react";
import { useSession } from "../../session/session-provider";

export function PartnerOperatorBoundary({ children }: { children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") {
    return (
      <section className="state-content workspace-restricted" aria-labelledby="partners-restricted-title">
        <div className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">صلاحية غير متاحة</p>
          <h1 id="partners-restricted-title">الشركاء مقصورة على مشغلي لوحة التحكم</h1>
          <p className="muted">هذه المساحة لا تمنح صلاحيات إضافية خارج دور Identity الموثق.</p>
        </div>
      </section>
    );
  }

  return children;
}
