import "server-only";
import type { OperatorSessionView } from "../features/session/session-provider";

// Identity has no accepted Operator browser session exchange yet. Fail closed;
// do not trust browser storage, developer credentials or caller-supplied role.
export async function readVerifiedOperatorSession(): Promise<OperatorSessionView> {
  return { status: "unavailable", grants: [] };
}
