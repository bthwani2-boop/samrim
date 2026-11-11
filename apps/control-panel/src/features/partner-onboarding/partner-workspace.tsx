"use client";

import { Fragment, type ReactNode } from "react";
import { useSession } from "../../session/session-provider";

export function PartnerOperatorBoundary({ children }: { children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated" || !state.identity.subject || !state.identity.sessionId) return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("partners")) {
    return (
      <section className="state-content workspace-restricted" aria-labelledby="partners-restricted-title">
        <div className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">صلاحية غير متاحة</p>
          <h1 id="partners-restricted-title">إدارة المتاجر تتطلب صلاحية الشركاء</h1>
          <p className="muted">اطلب الصلاحية من مسؤول الوصول.</p>
        </div>
      </section>
    );
  }

  return <Fragment key={JSON.stringify([state.identity.subject, state.identity.sessionId])}>{children}</Fragment>;
}
