import {
  type CustomerCartChange,
  DshCartError, prepareCustomerCartChange, readCurrentCustomerCart, replaceCurrentCustomerCart,
} from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "./cart-owner-origins.ts";

const noStore = {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;
const storeRule = /^[a-z0-9-]{1,64}$/;

function result(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStore });
}
async function boundedChange(request: Request): Promise<CustomerCartChange | null> {
  try { return prepareCustomerCartChange(await readBoundedCustomerJSON(request)); }
  catch { return null; }
}

/** Customer Web is a cookie-only presentation adapter. Identity and DSH own truth. */
export async function handleCustomerCart(request: Request, method: "GET" | "PUT"): Promise<Response> {
  const url = new URL(request.url);
  const storeIds = url.searchParams.getAll("storeId");
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return result({ error: "OWNER_UNAVAILABLE" }, 503);
  const { dsh: origin, identity: identityOrigin } = owners;
  const storeId = storeIds[0];
  if (url.searchParams.size !== 1 || storeIds.length !== 1 || !storeId || !storeRule.test(storeId)) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return result({ error: "FORBIDDEN" }, 403);
  if (method === "PUT" && request.headers.get("Origin") !== url.origin) {
    return result({ error: "FORBIDDEN" }, 403);
  }
  if (method === "GET" && (request.body || request.headers.get("Content-Length"))) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const change = method === "PUT" ? await boundedChange(request) : null;
  if (method === "PUT" && !change) return result({ error: "INVALID_REQUEST" }, 400);
  const expectedActor = request.headers.get("X-Customer-Context");
  if (method === "PUT" && !expectedActor) return result({ error: "INVALID_REQUEST" }, 400);
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return result({ error: "UNAUTHORIZED" }, 401);
  let dispatched = false;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
    const before = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    if (before.role !== "customer") return result({ error: "FORBIDDEN" }, 403);
    if (method === "PUT" && before.actorId !== expectedActor) {
      return result({ error: "CUSTOMER_CONTEXT_CHANGED" }, 403);
    }
    dispatched = method === "PUT";
    const value = method === "GET"
      ? await readCurrentCustomerCart(origin, bearer, storeId, before.actorId, signal)
      : await replaceCurrentCustomerCart(origin, bearer, storeId, before.actorId, change as CustomerCartChange, signal);
    const after = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    if (signal.aborted || after.role !== "customer" || before.actorId !== after.actorId) {
      return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" }, dispatched ? 503 : 401);
    }
    return result(value);
  } catch (error) {
    if (error instanceof DshCartError) {
      const allowed = [400, 401, 403, 404, 409].includes(error.status);
      return result({ error: allowed ? error.code : dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" },
        allowed ? error.status : 503);
    }
    if (error instanceof IdentityClientError && [401, 403].includes(error.status)) {
      return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" },
        dispatched ? 503 : error.status);
    }
    return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" }, 503);
  }
}
