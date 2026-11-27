import {
  type CustomerCart, type CustomerCartChange, type CustomerCartResult,
  DshCartError, prepareCustomerCartChange, readCurrentCustomerCart, replaceCurrentCustomerCart,
} from "@bthwani/dsh";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import { withCustomerOwnerSession } from "../access/customer-owner-session.ts";
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
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
  const outcome = await withCustomerOwnerSession<CustomerCart | CustomerCartResult>(
    identityOrigin, bearer, method === "PUT" ? expectedActor : null, signal,
    actor => change
      ? replaceCurrentCustomerCart(origin, bearer, storeId, actor, change, signal)
      : readCurrentCustomerCart(origin, bearer, storeId, actor, signal));
  if (outcome.kind === "accepted") return result(outcome.value);
  if (outcome.kind === "denied") {
    if (outcome.stage === "after" && method === "PUT") return result({ error: "OPERATION_RESULT_UNKNOWN" }, 503);
    const code = outcome.reason === "actor" && outcome.stage === "before" ? "CUSTOMER_CONTEXT_CHANGED"
      : outcome.status === 503 ? "OWNER_UNAVAILABLE"
        : outcome.reason === "role" && outcome.stage === "before" ? "FORBIDDEN" : "UNAUTHORIZED";
    return result({ error: code }, outcome.status);
  }
  if (outcome.error instanceof DshCartError && [400, 401, 403, 404, 409].includes(outcome.error.status)) {
    return result({ error: outcome.error.code }, outcome.error.status);
  }
  return result({ error: method === "PUT" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" }, 503);
}
