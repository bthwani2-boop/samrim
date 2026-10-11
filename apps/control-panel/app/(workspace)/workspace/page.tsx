"use client";

import { PageHeader } from "../../../src/shell/page-header";

import { useSession } from "../../../src/session/session-provider";
import { OperatorHome } from "../../../src/features/workspace/operator-home";

export default function WorkspacePage() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return <section className="state-content workspace-restricted"><div className="state-card" role="alert"><PageHeader title="مساحة المشغل غير متاحة" /><p className="muted">هذه الجلسة لا تملك دور المشغل المطلوب لهذه الأعمال.</p></div></section>;
  return <OperatorHome />;
}
