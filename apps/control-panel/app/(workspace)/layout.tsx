import type { ReactNode } from "react";
import OperatorWorkspaceGate from "../../src/features/access/operator-workspace-gate";

// Intentionally fail closed until the authoritative Identity session/permission flow exists.
export default function OperatorWorkspaceLayout({ children: _children }: Readonly<{ children: ReactNode }>) {
  return <OperatorWorkspaceGate />;
}
