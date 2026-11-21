import "server-only";
import { IdentityClientError, reviewOriginalOperatorPermissions } from "@bthwani/identity";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  OPERATOR_COOKIE, readVerifiedOperatorAccess, resolveIsolatedOperatorConfig,
} from "./operator-passkey-bff";

// React cache is scoped to one server render/request, not a shared actor cache.
// Every new navigation rechecks the Identity owner; missing service fails closed.
const currentOperatorConnection = cache(async () => {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return null;
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  return bearer ? { config, bearer } : null;
});

export const currentOperatorAccess = cache(async () => {
  const connection = await currentOperatorConnection();
  return connection ? readVerifiedOperatorAccess(connection.config, connection.bearer) : null;
});

export const currentOriginalOperatorPermissions = cache(async () => {
  const [connection, access] = await Promise.all([currentOperatorConnection(), currentOperatorAccess()]);
  if (!connection || !access) return null;
  try {
    const permissions = await reviewOriginalOperatorPermissions(connection.config.identityOrigin,
      connection.bearer, access.actorId, AbortSignal.timeout(4000));
    return { actorId: access.actorId, permissions };
  } catch {
    return null;
  }
});

export async function reviewOperatorPermissions(actorId: string) {
  const [connection, original] = await Promise.all([
    currentOperatorConnection(), currentOriginalOperatorPermissions(),
  ]);
  if (!connection || !original) return { status: "denied" } as const;
  if (actorId === original.actorId) {
    return { status: "available", originalActorId: original.actorId, permissions: original.permissions } as const;
  }
  try {
    const permissions = await reviewOriginalOperatorPermissions(connection.config.identityOrigin,
      connection.bearer, actorId, AbortSignal.timeout(4000));
    return { status: "available", originalActorId: original.actorId, permissions } as const;
  } catch (error) {
    if (error instanceof IdentityClientError) {
      if (error.status === 404) return { status: "notFound" } as const;
      if (error.status === 401 || error.status === 403) return { status: "denied" } as const;
    }
    return { status: "unavailable" } as const;
  }
}
