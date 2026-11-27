import { DshCartError, readCurrentCustomerCartMerchandiseEstimate } from "@bthwani/dsh";
import { withCustomerOwnerSession } from "../access/customer-owner-session.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "./cart-owner-origins.ts";

const safeHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;
const storeRule = /^[a-z0-9-]{1,64}$/;
const versionRule = /^(0|[1-9][0-9]{0,15})$/;

function result(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: safeHeaders });
}

/** Cookie-only Customer Web adapter. DSH owns amounts; Identity owns actors. */
export async function handleCustomerMerchandiseEstimate(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return result({ error: "OWNER_UNAVAILABLE" }, 503);
  const { dsh, identity } = owners;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return result({ error: "FORBIDDEN" }, 403);
  if (request.method !== "GET" || request.body || request.headers.get("Content-Length")) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const storeIds = url.searchParams.getAll("storeId");
  const versions = url.searchParams.getAll("expectedVersion");
  const storeId = storeIds[0];
  if (url.searchParams.size !== 2 || storeIds.length !== 1 || versions.length !== 1 ||
    !storeId || !storeRule.test(storeId) || !versions[0] || !versionRule.test(versions[0])) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const expectedVersion = Number(versions[0]);
  if (!Number.isSafeInteger(expectedVersion)) return result({ error: "INVALID_REQUEST" }, 400);
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return result({ error: "UNAUTHORIZED" }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
  const outcome = await withCustomerOwnerSession(identity, bearer, null, signal, actor =>
    readCurrentCustomerCartMerchandiseEstimate(dsh, bearer, storeId, actor, expectedVersion, signal));
  if (outcome.kind === "accepted") return result(outcome.value);
  if (outcome.kind === "denied") {
    const code = outcome.status === 503 ? "OWNER_UNAVAILABLE"
      : outcome.reason === "role" && outcome.stage === "before" ? "FORBIDDEN" : "UNAUTHORIZED";
    return result({ error: code }, outcome.status);
  }
  if (outcome.error instanceof DshCartError && [400, 401, 403, 409].includes(outcome.error.status)) {
    return result({ error: outcome.error.code }, outcome.error.status);
  }
  return result({ error: "OWNER_UNAVAILABLE" }, 503);
}
