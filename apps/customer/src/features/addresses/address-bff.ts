import {
  type CustomerAddressChange, DshPublicError, evaluateDeliveryServiceability, getCustomerAddress,
  isCustomerAddressId, listCustomerAddresses, normalizeCustomerAddressChange, saveCustomerAddress,
} from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "../cart/cart-owner-origins.ts";

type Command =
  | { kind: "list"; after?: string }
  | { kind: "read"; id: string }
  | { kind: "serviceability"; id: string; store: string }
  | { kind: "save"; id: string; change: CustomerAddressChange };
type Method = "GET" | "PUT" | "SERVICEABILITY";
type Owners = NonNullable<ReturnType<typeof customerCartOwnerOrigins>>;
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

const response = (value: unknown, status = 200) => Response.json(value, { status, headers: {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} });
const rejected = (error: string, status: number) => response({ error }, status);
const uncertain = () => rejected("OPERATION_RESULT_UNKNOWN", 503);
const unavailable = () => rejected("OWNER_UNAVAILABLE", 503);

async function admitCommand(request: Request, url: URL, method: Method): Promise<Command | null> {
  const params = url.searchParams;
  const id = params.get("addressId");
  if (method !== "PUT" && (request.body || request.headers.get("Content-Length"))) return null;
  if (method === "SERVICEABILITY") {
    const store = params.get("storeId");
    return params.size === 2 && id !== null && isCustomerAddressId(id) && store && /^[a-z0-9-]{1,64}$/.test(store)
      ? { kind: "serviceability", id, store } : null;
  }
  if (method === "PUT") {
    if (params.size !== 1 || id === null || !isCustomerAddressId(id)) return null;
    const change = normalizeCustomerAddressChange(await readBoundedCustomerJSON(request, 4096));
    return change ? { kind: "save", id, change } : null;
  }
  if (id !== null) return params.size === 1 && isCustomerAddressId(id) ? { kind: "read", id } : null;
  const after = params.get("after");
  if (params.size === 0) return { kind: "list" };
  return params.size === 1 && after !== null && isCustomerAddressId(after) ? { kind: "list", after } : null;
}

async function ownerOutcome(owners: Owners, bearer: string, actor: string, command: Command, signal: AbortSignal): Promise<Outcome> {
  try {
    let value: unknown;
    switch (command.kind) {
      case "save": value = await saveCustomerAddress(owners.dsh, bearer, actor, command.id, command.change, signal); break;
      case "read": value = await getCustomerAddress(owners.dsh, bearer, actor, command.id, signal); break;
      case "serviceability": value = await evaluateDeliveryServiceability(owners.dsh, bearer, actor, command.store, command.id, signal); break;
      case "list": value = await listCustomerAddresses(owners.dsh, bearer, actor, command.after, signal); break;
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function verifiedOutcome(outcome: Outcome, mutating: boolean): Response {
  if (outcome.ok) return response(outcome.value);
  const error = outcome.error;
  if (error instanceof DshPublicError && [400, 401, 403, 404, 409].includes(error.status)) {
    return rejected(error.code, error.status);
  }
  return mutating ? uncertain() : unavailable();
}

/** Identity admits both successful and rejected owner outcomes to the same actor. */
export async function handleCustomerAddresses(request: Request, method: Method): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return unavailable();
  const site = request.headers.get("Sec-Fetch-Site");
  if ((site && site !== "same-origin") || (method === "PUT" && request.headers.get("Origin") !== url.origin)) {
    return rejected("FORBIDDEN", 403);
  }
  const actor = request.headers.get("X-Customer-Context");
  const bearer = bearerForCustomerRequest(request);
  // Selector and command admission remain independent of owner traffic.
  let command: Command | null;
  try {
    command = await admitCommand(request, url, method);
  } catch {
    return rejected("INVALID_REQUEST", 400);
  }
  if (!command) return rejected("INVALID_REQUEST", 400);
  if (!bearer) return rejected("UNAUTHORIZED", 401);
  if (!actor) return rejected("INVALID_REQUEST", 400);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  let dispatched = false;
  try {
    const before = await readVerifiedIdentitySession(owners.identity, bearer, signal);
    if (before.role !== "customer" || before.actorId !== actor) return rejected("FORBIDDEN", 403);
    if (signal.aborted) return unavailable();
    dispatched = command.kind === "save";
    const outcome = await ownerOutcome(owners, bearer, actor, command, signal);
    const after = await readVerifiedIdentitySession(owners.identity, bearer, signal);
    if (signal.aborted || after.actorId !== actor || after.role !== "customer") {
      return dispatched ? uncertain() : rejected("UNAUTHORIZED", 401);
    }
    return verifiedOutcome(outcome, dispatched);
  } catch (error) {
    if (dispatched) return uncertain();
    if (error instanceof IdentityClientError && [401, 403].includes(error.status)) {
      return rejected("UNAUTHORIZED", error.status);
    }
    return unavailable();
  }
}
