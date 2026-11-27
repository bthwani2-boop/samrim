import { DshPublicError, reviewCurrentCustomerCheckout, validCustomerCheckoutReviewInput } from "@bthwani/dsh";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import { withCustomerOwnerSession } from "../access/customer-owner-session.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "../cart/cart-owner-origins.ts";

const reply = (value: unknown, status = 200): Response => Response.json(value, { status, headers: {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });

export async function handleCustomerCheckoutReview(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return reply({ error: "OWNER_UNAVAILABLE" }, 503);
  const site = request.headers.get("Sec-Fetch-Site");
  if ((site && site !== "same-origin") || request.headers.get("Origin") !== url.origin) return reply({ error: "FORBIDDEN" }, 403);
  const store = url.searchParams.get("storeId");
  const actor = request.headers.get("X-Customer-Context");
  if (request.method !== "POST" || url.searchParams.size !== 1 || !store || !/^[a-z0-9-]{1,64}$/.test(store) ||
    !actor || request.headers.get("Content-Encoding")) return reply({ error: "INVALID_REQUEST" }, 400);
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return reply({ error: "UNAUTHORIZED" }, 401);
  const input = await readBoundedCustomerJSON(request, 4096);
  if (!validCustomerCheckoutReviewInput(input)) return reply({ error: "INVALID_REQUEST" }, 400);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
  const outcome = await withCustomerOwnerSession(owners.identity, bearer, actor, signal,
    verified => reviewCurrentCustomerCheckout(owners.dsh, bearer, verified, store, input, signal));
  if (outcome.kind === "accepted") return reply(outcome.value);
  if (outcome.kind === "denied") {
    const code = outcome.status === 503 ? "OWNER_UNAVAILABLE"
      : outcome.stage === "before" && (outcome.reason === "role" || outcome.reason === "actor")
        ? "FORBIDDEN" : "UNAUTHORIZED";
    return reply({ error: code }, outcome.status);
  }
  if (outcome.error instanceof DshPublicError && [400, 401, 403, 409].includes(outcome.error.status)) {
    return reply({ error: outcome.error.code }, outcome.error.status);
  }
  return reply({ error: "OWNER_UNAVAILABLE" }, 503);
}
