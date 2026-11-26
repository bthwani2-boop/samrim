import { identityOperations } from "@bthwani/identity";
import { type OperatorPermission, operatorPermissions } from "../features/session/operator-permissions.ts";
import type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";
import { boundedResponseJSON, operatorIdentityRequest, operatorPermissionOperation } from "./operator-passkey-transport.ts";
import { cookieLifetimeSeconds, exactKeys, object, parseVerifiedOperatorPrincipal } from "./operator-passkey-validation.ts";

export type VerifiedOperatorWorkspaceAccess = Readonly<{
  actorId: string;
  sessionExpiresAt: string;
  grants: readonly OperatorPermission[];
}>;

// This server-side check is a navigation/read gate only; every DSH/WLT
// mutation must still verify the actor and the resource permission itself.
// Any broken owner response fails closed rather than inventing grants.
export async function readVerifiedOperatorAccess(
  config: OperatorPasskeyConfig,
  accessToken: string,
): Promise<VerifiedOperatorWorkspaceAccess | null> {
  const result = await readOperatorAccessState(config, accessToken);
  return result.status === "verified" ? result.access : null;
}

export type OperatorAccessState =
  | { status: "verified"; access: VerifiedOperatorWorkspaceAccess }
  | { status: "signed-out" | "unavailable" };

export async function readOperatorAccessState(
  config: OperatorPasskeyConfig,
  accessToken: string,
): Promise<OperatorAccessState> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return { status: "signed-out" };
  try {
    const authorization = { Authorization: `Bearer ${accessToken}` };
    const verified = await operatorIdentityRequest(config, identityOperations.getVerifiedIdentitySession, {
      headers: authorization,
    });
    if (verified.status === 401) return { status: "signed-out" };
    if (verified.status !== 200) return { status: "unavailable" };
    const principalValue = object(await boundedResponseJSON(verified));
    if (principalValue && (principalValue.role === "customer" ||
        principalValue.role === "merchant" || principalValue.role === "captain")) {
      return { status: "signed-out" };
    }
    const expiry = principalValue?.sessionExpiresAt;
    if (typeof expiry !== "string") return { status: "unavailable" };
    const principal = parseVerifiedOperatorPrincipal(principalValue, {
      accessToken, sessionExpiresAt: expiry,
    });
    if (!principal) return { status: "unavailable" };

    const results = await Promise.all(operatorPermissions.map(async (permission) => {
      const reply = await operatorIdentityRequest(
        config, operatorPermissionOperation(permission), { headers: authorization },
      );
      if (reply.status === 401) return "signed-out";
      if (reply.status === 403) return "denied";
      if (reply.status !== 200) throw new Error("Identity permission read unavailable");
      const value = await boundedResponseJSON(reply);
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
      if (!record || !exactKeys(record, ["actorId", "permission"]) ||
          record.actorId !== principal.actorId || record.permission !== permission) {
        throw new Error("Inconsistent Identity permission owner response");
      }
      return "granted";
    }));
    if (results.includes("signed-out") || cookieLifetimeSeconds(principal.sessionExpiresAt) <= 0) {
      return { status: "signed-out" };
    }
    return {
      status: "verified",
      access: {
        actorId: principal.actorId,
        sessionExpiresAt: principal.sessionExpiresAt,
        grants: operatorPermissions.filter((_, index) => results[index] === "granted"),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
