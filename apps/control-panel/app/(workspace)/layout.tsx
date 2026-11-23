import { headers } from "next/headers";
import type { ReactNode } from "react";
import OperatorWorkspaceGate from "../../src/features/access/operator-workspace-gate";
import { canEnterOperatorWorkspace } from "../../src/features/session/operator-permissions";
import { currentOperatorAccessState, currentOriginalOperatorPermissions } from "../../src/server/current-operator-access";

// The proxy overwrites x-bthwani-route with the actual URL (not a client claim).
// The session and each effective scope are read from Identity on every request.
// These pages contain no privileged domain data until each DSH/WLT owner API
// independently enforces resource authorization.
export default async function OperatorWorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [state, requestHeaders, originalOperator] = await Promise.all([
    currentOperatorAccessState(), headers(), currentOriginalOperatorPermissions(),
  ]);
  const access = state.status === "verified" ? state.access : null;
  const allowed = access !== null && canEnterOperatorWorkspace(
    access.grants, requestHeaders.get("x-bthwani-route") ?? "", originalOperator !== null,
  );
  if (!allowed) return <OperatorWorkspaceGate hasWorkspace={Boolean(access?.grants.length)}
    identityUnavailable={state.status === "unavailable"} />;
  return <>{children}</>;
}
