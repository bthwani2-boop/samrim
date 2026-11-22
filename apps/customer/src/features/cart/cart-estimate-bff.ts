import {
  DshCartError, readCurrentCustomerCartMerchandiseEstimate,
} from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerForCustomerRequest } from "../access/customer-session-cookie";

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
  const dsh = process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  const identity = process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN;
  if (process.env.BTHWANI_SURFACE_PREVIEW !== "1" || !dsh || !identity ||
    !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return result({ error: "OWNER_UNAVAILABLE" }, 503);
  }
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return result({ error: "FORBIDDEN" }, 403);
  if (request.method !== "GET" || request.body || request.headers.get("Content-Length")) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const storeIds = url.searchParams.getAll("storeId");
  const versions = url.searchParams.getAll("expectedVersion");
  if (url.searchParams.size !== 2 || storeIds.length !== 1 || versions.length !== 1 ||
    !storeIds[0] || !storeRule.test(storeIds[0]) || !versions[0] || !versionRule.test(versions[0])) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const expectedVersion = Number(versions[0]);
  if (!Number.isSafeInteger(expectedVersion)) return result({ error: "INVALID_REQUEST" }, 400);
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return result({ error: "UNAUTHORIZED" }, 401);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
    const before = await readVerifiedIdentitySession(identity, bearer, signal);
    if (before.role !== "customer") return result({ error: "FORBIDDEN" }, 403);
    const estimate = await readCurrentCustomerCartMerchandiseEstimate(
      dsh, bearer, storeIds[0], before.actorId, expectedVersion, signal);
    const after = await readVerifiedIdentitySession(identity, bearer, signal);
    if (signal.aborted || after.role !== "customer" || after.actorId !== before.actorId) {
      return result({ error: "UNAUTHORIZED" }, 401);
    }
    return result(estimate);
  } catch (error) {
    if (error instanceof DshCartError && [400, 401, 403, 409].includes(error.status)) {
      return result({ error: error.code }, error.status);
    }
    if (error instanceof IdentityClientError && [401, 403].includes(error.status)) {
      return result({ error: "UNAUTHORIZED" }, error.status);
    }
    return result({ error: "OWNER_UNAVAILABLE" }, 503);
  }
}
