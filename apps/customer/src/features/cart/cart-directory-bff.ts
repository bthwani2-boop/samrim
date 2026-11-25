import { DshPublicError, listCurrentCustomerCarts } from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";
import { customerCartOwnerOrigins } from "./cart-owner-origins.ts";

const result=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
export async function handleCustomerCartDirectory(request:Request):Promise<Response>{
  const url=new URL(request.url),owners=customerCartOwnerOrigins(url);
  if(!owners) return result({error:"OWNER_UNAVAILABLE"},503);
  const site=request.headers.get("Sec-Fetch-Site"),origin=request.headers.get("Origin");
  if((site&&site!=="same-origin")||(origin&&origin!==url.origin)) return result({error:"FORBIDDEN"},403);
  const after=url.searchParams.get("after");
  if(request.method!=="GET"||request.body||request.headers.has("Transfer-Encoding")||
    (request.headers.has("Content-Length")&&request.headers.get("Content-Length")!=="0")||
    url.searchParams.size!==(after===null?0:1)||(after!==null&&!/^[a-z0-9-]{1,64}$/.test(after))) return result({error:"INVALID_REQUEST"},400);
  const bearer=bearerForCustomerRequest(request), actor=request.headers.get("X-Customer-Context");
  if(!bearer) return result({error:"UNAUTHORIZED"},401);
  if(!actor) return result({error:"INVALID_REQUEST"},400);
  try {
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
    const before=await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if(before.role!=="customer"||before.actorId!==actor) return result({error:"FORBIDDEN"},403);
    const page=await listCurrentCustomerCarts(owners.dsh,bearer,actor,after??undefined,signal);
    const current=await readVerifiedIdentitySession(owners.identity,bearer,signal);
    if(signal.aborted||current.role!=="customer"||current.actorId!==actor) return result({error:"UNAUTHORIZED"},401);
    return result(page);
  } catch(error){
    if((error instanceof DshPublicError||error instanceof IdentityClientError)&&[400,401,403].includes(error.status))
      return result({error:"DIRECTORY_REQUEST_REJECTED"},error.status);
    return result({error:"OWNER_UNAVAILABLE"},503);
  }
}