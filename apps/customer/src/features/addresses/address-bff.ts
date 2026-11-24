import { DshPublicError, isCustomerAddressId, listCustomerAddresses, saveCustomerAddress, validCustomerAddressChange } from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "../cart/cart-owner-origins.ts";

const response = (value: unknown, status = 200) => Response.json(value, { status, headers: {
  "Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
} });
export async function handleCustomerAddresses(request: Request, method: "GET"|"PUT"): Promise<Response> {
  const url = new URL(request.url);
  const owners = customerCartOwnerOrigins(url);
  if (!owners) return response({error:"OWNER_UNAVAILABLE"},503);
  const site = request.headers.get("Sec-Fetch-Site");
  if ((site && site !== "same-origin") || (method === "PUT" && request.headers.get("Origin") !== url.origin)) {
    return response({error:"FORBIDDEN"},403);
  }
  const key = method === "GET" ? "after" : "addressId";
  const id = url.searchParams.get(key);
  if (url.searchParams.size !== (id === null ? 0 : 1) ||
    (id !== null && !isCustomerAddressId(id)) ||
    (method === "PUT" && id === null) ||
    (method === "GET" && (request.body || request.headers.get("Content-Length")))) {
    return response({error:"INVALID_REQUEST"},400);
  }
  const actor = request.headers.get("X-Customer-Context");
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return response({error:"UNAUTHORIZED"},401);
  if (!actor) return response({error:"INVALID_REQUEST"},400);
  const change = method === "PUT" ? await readBoundedCustomerJSON(request,4096) : null;
  if (method === "PUT" && !validCustomerAddressChange(change)) return response({error:"INVALID_REQUEST"},400);
  let dispatched = false;
  try {
    const signal = AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
    const current = await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if (current.role !== "customer" || current.actorId !== actor) return response({error:"FORBIDDEN"},403);
    dispatched = method === "PUT";
    const value = method === "PUT" && id && validCustomerAddressChange(change)
      ? await saveCustomerAddress(owners.dsh,bearer,actor,id,change,signal)
      : await listCustomerAddresses(owners.dsh,bearer,actor,id ?? undefined,signal);
    const after = await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if (signal.aborted || after.actorId !== actor || after.role !== "customer") {
      return response({error:dispatched?"OPERATION_RESULT_UNKNOWN":"UNAUTHORIZED"},dispatched?503:401);
    }
    return response(value);
  } catch(error) {
    if (error instanceof DshPublicError && [400,401,403,404,409].includes(error.status)) {
      return response({error:error.code},error.status);
    }
    if (!dispatched && error instanceof IdentityClientError && [401,403].includes(error.status)) {
      return response({error:"UNAUTHORIZED"},error.status);
    }
    return response({error:dispatched?"OPERATION_RESULT_UNKNOWN":"OWNER_UNAVAILABLE"},503);
  }
}
