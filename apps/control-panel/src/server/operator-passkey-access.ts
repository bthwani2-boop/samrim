import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";
import { boundedResponseJSON, operatorIdentityRequest, operatorPermissionOperation } from "./operator-passkey-transport.ts";
import {
  cookieLifetimeSeconds,
  exactKeys,
  object,
  parseVerifiedOperatorPrincipal,
  type VerifiedOperatorPrincipal,
} from "./operator-passkey-validation.ts";

export type VerifiedOperatorWorkspaceAccess = Readonly<{
  actorId: string;
  sessionExpiresAt: string;
  grants: readonly OperatorPermission[];
}>;

type AccessFailure = { status: "signed-out" | "unavailable" };
type PrincipalOutcome = { status: "verified"; principal: VerifiedOperatorPrincipal } | AccessFailure;
type PermissionOutcome = "granted" | "denied" | "signed-out" | "unavailable";
export type OperatorAccessState = { status: "verified"; access: VerifiedOperatorWorkspaceAccess } | AccessFailure;

async function readPrincipal(config: OperatorPasskeyConfig, accessToken: string): Promise<PrincipalOutcome> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return { status: "signed-out" };
  try {
    const reply = await operatorIdentityRequest(config, identityOperations.getVerifiedIdentitySession, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (reply.status === 401) return { status: "signed-out" };
    if (reply.status !== 200) return { status: "unavailable" };
    const record = object(await boundedResponseJSON(reply));
    if (record?.role === "customer" || record?.role === "merchant" || record?.role === "captain") {
      return { status: "signed-out" };
    }
    if (typeof record?.sessionExpiresAt !== "string") return { status: "unavailable" };
    const principal = parseVerifiedOperatorPrincipal(record, { accessToken, sessionExpiresAt: record.sessionExpiresAt });
    return principal ? { status: "verified", principal } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

async function readPermission(
  config: OperatorPasskeyConfig,
  authorization: { Authorization: string },
  actorId: string,
  permission: OperatorPermission,
): Promise<PermissionOutcome> {
  try {
    const reply = await operatorIdentityRequest(config, operatorPermissionOperation(permission), {
      headers: authorization,
    });
    if (reply.status === 401) return "signed-out";
    if (reply.status === 403) return "denied";
    if (reply.status !== 200) return "unavailable";
    const record = object(await boundedResponseJSON(reply));
    return record && exactKeys(record, ["actorId", "permission"]) &&
      record.actorId === actorId && record.permission === permission ? "granted" : "unavailable";
  } catch {
    return "unavailable";
  }
}

// Identity alone determines session validity and the seven explicit grants.
// Keep every bounded read's outcome: a peer grant failure cannot mask an
// authoritative invalid-session reply. No incomplete grant set is admitted.
export async function readOperatorAccessState(
  config: OperatorPasskeyConfig,
  accessToken: string,
): Promise<OperatorAccessState> {
  const state = await readPrincipal(config, accessToken);
  if (state.status !== "verified") return state;
  const { principal } = state;
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const outcomes = await Promise.all(operatorPermissions.map(permission =>
    readPermission(config, authorization, principal.actorId, permission),
  ));
  if (outcomes.includes("signed-out") || cookieLifetimeSeconds(principal.sessionExpiresAt) <= 0) {
    return { status: "signed-out" };
  }
  if (outcomes.includes("unavailable")) return { status: "unavailable" };
  return {
    status: "verified",
    access: {
      actorId: principal.actorId,
      sessionExpiresAt: principal.sessionExpiresAt,
      grants: operatorPermissions.filter((_, index) => outcomes[index] === "granted"),
    },
  };
}

// This gate is not a domain authorization grant. Every owner still verifies
// the actor, resource and current permission at its own operation boundary.
export async function readVerifiedOperatorAccess(
  config: OperatorPasskeyConfig,
  accessToken: string,
): Promise<VerifiedOperatorWorkspaceAccess | null> {
  const state = await readOperatorAccessState(config, accessToken);
  return state.status === "verified" ? state.access : null;
}
