import { type CustomerCartDirectory, DshPublicError, listCurrentCustomerCarts, parseCustomerCartDirectory } from "@bthwani/dsh";
import { Platform } from "react-native";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOwner=process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
export async function verifyCartDirectorySession(signal:AbortSignal,actor?:string){
  const result=await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if(!result.enabled) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
  if(result.session?.role!=="customer"||(actor!==undefined&&result.session.actorId!==actor)||
    !(Date.parse(result.session.sessionExpiresAt)>Date.now())) throw new DshPublicError(401,"UNAUTHORIZED");
  return result.session;
}
export async function readVerifiedCartDirectory(signal:AbortSignal,after?:string,actor?:string):Promise<{value:CustomerCartDirectory;expiresAt:number}>{
  if(after!==undefined&&!/^[a-z0-9-]{1,64}$/.test(after)) throw new DshPublicError(400,"INVALID_REQUEST");
  const before=await verifyCartDirectorySession(signal,actor);
  const expiresAt=Date.parse(before.sessionExpiresAt);
  if(Platform.OS==="web"){
    const response=await fetch("/api/customer-auth/carts"+(after?"?after="+after:""),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal,
      headers:{"X-Customer-Context":before.actorId}});
    if(response.status!==200||response.headers.get("Cache-Control")?.toLowerCase()!=="no-store"){
      void response.body?.cancel().catch(()=>{});
      throw new DshPublicError(response.status===401||response.status===403?401:503,"DIRECTORY_REQUEST_REJECTED");
    }
    const body=await readBoundedCustomerJSON({headers:response.headers,body:response.body,signal},32768);
    const value=parseCustomerCartDirectory(body,before.actorId,after);
    const current=await verifyCartDirectorySession(signal,before.actorId);
    return {value,expiresAt:Math.min(expiresAt,Date.parse(current.sessionExpiresAt))};
  }
  if(!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
  const result=await withVerifiedNativeCustomerRead(signal,bearer=>listCurrentCustomerCarts(nativeOwner,bearer,before.actorId,after,signal),before.actorId);
  if(result.kind!=="ready") throw new DshPublicError(result.kind==="signed-out"?401:503,"DIRECTORY_REQUEST_REJECTED");
  return {value:result.value,expiresAt:Math.min(expiresAt,result.expiresAt)};
}