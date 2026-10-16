"use client";

import { useSession } from "../../session/session-provider";
import { EmployeeDirectory } from "./employee-directory";

export function HRCenterWorkspace() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("hr")) {
    return <section className="state-content workspace-restricted" role="alert"><h1>صلاحية الموارد البشرية غير متاحة</h1><p>تحتاج إلى صلاحية الموارد البشرية لفتح ملفات الموظفين.</p></section>;
  }
  return <EmployeeDirectory />;
}
