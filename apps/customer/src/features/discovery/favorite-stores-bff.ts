import { DshPublicError, getCustomerFavoriteStore, isFavoriteStoreId, listCustomerFavoriteStores, setCustomerFavoriteStore } from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "../cart/cart-owner-origins.ts";

const response = (value: unknown, status = 200) => Response.json(value,{status,headers:{
  "Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
}});

export async function handleCustomerFavorites(request: Request, method: "GET"|"PUT"): Promise<Response> {
  const url=new URL(request.url);
  const owners=customerCartOwnerOrigins(url);
  if (!owners) return response({error:"OWNER_UNAVAILABLE"},503);
  const site=request.headers.get("Sec-Fetch-Site");
  if ((site && site!=="same-origin") || (method==="PUT" && request.headers.get("Origin")!==url.origin)) {
    return response({error:"FORBIDDEN"},403);
  }
  const id=url.searchParams.get("storeId"), after=url.searchParams.get("after"), desired=url.searchParams.get("favorite");
  // The BFF accepts exact selectors only, never an actor or caller URL.
  // The SDK constructs the canonical single-field JSON owner command.
  if (request.body || (request.headers.has("Content-Length") && request.headers.get("Content-Length")!=="0") ||
    (id!==null && !isFavoriteStoreId(id)) || (after!==null && !isFavoriteStoreId(after)) ||
    (method==="PUT" ? !id || after!==null || (desired!=="true" && desired!=="false") || url.searchParams.size!==2 :
      desired!==null || (id!==null && after!==null) || url.searchParams.size!==(id!==null || after!==null ? 1 : 0))) {
    return response({error:"INVALID_REQUEST"},400);
  }
  const actor=request.headers.get("X-Customer-Context");
  const bearer=bearerForCustomerRequest(request);
  if (!bearer) return response({error:"UNAUTHORIZED"},401);
  if (!actor) return response({error:"INVALID_REQUEST"},400);
  let dispatched=false;
  try {
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
    const current=await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if (current.role!=="customer" || current.actorId!==actor) return response({error:"FORBIDDEN"},403);
    dispatched=method==="PUT";
    const value=method==="PUT" && id
      ? await setCustomerFavoriteStore(owners.dsh,bearer,actor,id,desired==="true",signal)
      : id ? await getCustomerFavoriteStore(owners.dsh,bearer,actor,id,signal)
        : await listCustomerFavoriteStores(owners.dsh,bearer,actor,after??undefined,signal);
    const verified=await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if (signal.aborted || verified.role!=="customer" || verified.actorId!==actor) {
      return response({error:dispatched?"OPERATION_RESULT_UNKNOWN":"UNAUTHORIZED"},dispatched?503:401);
    }
    return response(value);
  } catch(error) {
    if (error instanceof DshPublicError && [400,401,403,404].includes(error.status)) return response({error:error.code},error.status);
    if (!dispatched && error instanceof IdentityClientError && [401,403].includes(error.status)) return response({error:"UNAUTHORIZED"},error.status);
    return response({error:dispatched?"OPERATION_RESULT_UNKNOWN":"OWNER_UNAVAILABLE"},503);
  }
}
