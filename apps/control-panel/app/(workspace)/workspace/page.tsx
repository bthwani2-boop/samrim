"use client";

import { useSession } from "../../../src/session/session-provider";
import { OperatorHome } from "../../../src/features/workspace/operator-home";

export default function WorkspacePage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><p className="eyebrow">صلاحية غير متاحة</p><h1>مساحة المشغل غير متاحة</h1><p className="muted">هذه الجلسة لا تملك دور المشغل المطلوب لهذه الأعمال.</p></div></section>;
  return <OperatorHome />;
}
