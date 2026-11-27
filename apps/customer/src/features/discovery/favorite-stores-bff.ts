import {
  DshPublicError, getCustomerFavoriteStore, isFavoriteStoreId, listCustomerFavoriteStores, setCustomerFavoriteStore,
} from "@bthwani/dsh";
import { withCustomerOwnerSession } from "../access/customer-owner-session.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "../cart/cart-owner-origins.ts";

const response = (value: unknown, status = 200) => Response.json(value, { status, headers: {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });

export async function handleCustomerFavorites(request: Request, method: "GET" | "PUT"): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return response({ error: "OWNER_UNAVAILABLE" }, 503);
  const site = request.headers.get("Sec-Fetch-Site");
  if ((site && site !== "same-origin") || (method === "PUT" && request.headers.get("Origin") !== url.origin)) {
    return response({ error: "FORBIDDEN" }, 403);
  }
  const id = url.searchParams.get("storeId");
  const after = url.searchParams.get("after");
  const desired = url.searchParams.get("favorite");
  // The BFF accepts exact selectors only, never an actor or caller URL.
  if (request.body || (request.headers.has("Content-Length") && request.headers.get("Content-Length") !== "0") ||
    (id !== null && !isFavoriteStoreId(id)) || (after !== null && !isFavoriteStoreId(after)) ||
    (method === "PUT" ? !id || after !== null || (desired !== "true" && desired !== "false") || url.searchParams.size !== 2 :
      desired !== null || (id !== null && after !== null) || url.searchParams.size !== (id !== null || after !== null ? 1 : 0))) {
    return response({ error: "INVALID_REQUEST" }, 400);
  }
  const actor = request.headers.get("X-Customer-Context");
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return response({ error: "UNAUTHORIZED" }, 401);
  if (!actor) return response({ error: "INVALID_REQUEST" }, 400);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  const outcome = await withCustomerOwnerSession<unknown>(owners.identity, bearer, actor, signal,
    verified => method === "PUT" && id
      ? setCustomerFavoriteStore(owners.dsh, bearer, verified, id, desired === "true", signal)
      : id ? getCustomerFavoriteStore(owners.dsh, bearer, verified, id, signal)
        : listCustomerFavoriteStores(owners.dsh, bearer, verified, after ?? undefined, signal));
  if (outcome.kind === "accepted") return response(outcome.value);
  if (outcome.kind === "denied") {
    if (outcome.stage === "after" && method === "PUT") return response({ error: "OPERATION_RESULT_UNKNOWN" }, 503);
    const code = outcome.status === 503 ? "OWNER_UNAVAILABLE"
      : outcome.stage === "before" && (outcome.reason === "role" || outcome.reason === "actor")
        ? "FORBIDDEN" : "UNAUTHORIZED";
    return response({ error: code }, outcome.status);
  }
  if (outcome.error instanceof DshPublicError && [400, 401, 403, 404].includes(outcome.error.status)) {
    return response({ error: outcome.error.code }, outcome.error.status);
  }
  return response({ error: method === "PUT" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" }, 503);
}
