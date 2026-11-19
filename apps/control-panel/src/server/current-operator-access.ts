import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  OPERATOR_COOKIE, readVerifiedOperatorAccess, resolveIsolatedOperatorConfig,
} from "./operator-passkey-bff";

// React cache is scoped to one server render/request, not a shared actor cache.
// Every new navigation rechecks the Identity owner; missing service fails closed.
export const currentOperatorAccess = cache(async () => {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return null;
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer) return null;
  return readVerifiedOperatorAccess(config, bearer);
});
