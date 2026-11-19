import { headers } from "next/headers";
import type { ReactNode } from "react";
import OperatorWorkspaceGate from "../../src/features/access/operator-workspace-gate";
import { canEnterOperatorWorkspace } from "../../src/features/session/operator-permissions";
import { currentOperatorAccess } from "../../src/server/current-operator-access";

// The proxy overwrites x-bthwani-route with the actual URL (not a client claim).
// The session and each effective scope are read from Identity on every request.
// These pages contain no privileged domain data until each DSH/WLT owner API
// independently enforces resource authorization.
export default async function OperatorWorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [access, requestHeaders] = await Promise.all([currentOperatorAccess(), headers()]);
  const allowed = access !== null && canEnterOperatorWorkspace(
    access.grants, requestHeaders.get("x-bthwani-route") ?? "",
  );
  if (!allowed) return <OperatorWorkspaceGate />;
  return <>{children}</>;
}
