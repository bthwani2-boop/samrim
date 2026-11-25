import { DshPublicError, type FavoriteStorePage, type FavoriteStoreState, getCustomerFavoriteStore, isFavoriteStoreId,
  listCustomerFavoriteStores, parseFavoriteStorePage, parseFavoriteStoreState, setCustomerFavoriteStore } from "@bthwani/dsh";
import { Platform } from "react-native";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOwner=process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route="/api/customer-auth/favorite-stores";

export async function verifyFavoriteSession(signal: AbortSignal, actor?: string) {
  const value=await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!value.enabled || value.session?.role!=="customer" || (actor!==undefined && actor!==value.session.actorId) ||
    Date.parse(value.session.sessionExpiresAt)<=Date.now()) throw new DshPublicError(401,"UNAUTHORIZED");
  return value.session;
}
async function webRequest(actor: string, query: string, signal: AbortSignal, write: boolean): Promise<unknown> {
  let result: Response;
  try {
    result=await fetch(route+query,{method:write?"PUT":"GET",credentials:"same-origin",redirect:"error",cache:"no-store",signal,
      headers:{"X-Customer-Context":actor}});
  } catch { throw new DshPublicError(503,write?"OPERATION_RESULT_UNKNOWN":"OWNER_UNAVAILABLE"); }
  signal.throwIfAborted();
  if (!result.ok) throw new DshPublicError(result.status,write && result.status>=500?"OPERATION_RESULT_UNKNOWN":"FAVORITE_REQUEST_REJECTED");
  if (result.headers.get("Cache-Control")!=="no-store") throw new DshPublicError(502,write?"OPERATION_RESULT_UNKNOWN":"OWNER_RESPONSE_INVALID");
  const body=await readBoundedCustomerJSON({headers:result.headers,body:result.body,signal});
  signal.throwIfAborted();
  if (body===null) {
    void result.body?.cancel().catch(()=>{});
    throw new DshPublicError(502,write?"OPERATION_RESULT_UNKNOWN":"OWNER_RESPONSE_INVALID");
  }
  return body;
}
async function verified<T extends {actorId:string}>(signal: AbortSignal,actor: string|undefined,
  web: (actor:string)=>Promise<T>,native:(actor:string,bearer:string)=>Promise<T>,mutating=false) {
  const before=await verifyFavoriteSession(signal,actor);
  let expiresAt=Date.parse(before.sessionExpiresAt);
  let dispatched=false;
  try {
    if (Platform.OS==="web") {
      dispatched=mutating;
      const value=await web(before.actorId);
      const after=await verifyFavoriteSession(signal,before.actorId);
      expiresAt=Math.min(expiresAt,Date.parse(after.sessionExpiresAt));
      signal.throwIfAborted();
      return {value,expiresAt};
    }
    if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
    const result=await withVerifiedNativeCustomerRead(signal,bearer=>{
      dispatched=mutating;
      return native(before.actorId,bearer);
    },before.actorId);
    if (result.kind!=="ready") throw new DshPublicError(result.kind==="signed-out"?401:503,"OWNER_UNAVAILABLE");
    signal.throwIfAborted();
    return {value:result.value,expiresAt:Math.min(expiresAt,result.expiresAt)};
  } catch(error) {
    // Once a write was dispatched, loss of the verified session or response
    // cannot prove that the owner's durable transaction was rolled back.
    if (dispatched && (!(error instanceof DshPublicError) || ![400,404].includes(error.status))) {
      throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
    }
    throw error;
  }
}
export async function readFavoriteStores(signal:AbortSignal,actor?:string,after?:string):Promise<{value:FavoriteStorePage;expiresAt:number}> {
  if (after!==undefined && !isFavoriteStoreId(after)) throw new DshPublicError(400,"INVALID_REQUEST");
  return verified(signal,actor,async a=>parseFavoriteStorePage(await webRequest(a,after?"?after="+after:"",signal,false),a,after),
    (a,b)=>listCustomerFavoriteStores(nativeOwner??"",b,a,after,signal));
}
export async function readFavoriteStore(signal:AbortSignal,id:string,actor?:string):Promise<{value:FavoriteStoreState;expiresAt:number}> {
  if (!isFavoriteStoreId(id)) throw new DshPublicError(400,"INVALID_REQUEST");
  return verified(signal,actor,async a=>parseFavoriteStoreState(await webRequest(a,"?storeId="+id,signal,false),a,id),
    (a,b)=>getCustomerFavoriteStore(nativeOwner??"",b,a,id,signal));
}
export async function writeFavoriteStore(signal:AbortSignal,actor:string,id:string,favorite:boolean) {
  if (!isFavoriteStoreId(id)) throw new DshPublicError(400,"INVALID_REQUEST");
  return verified(signal,actor,async a=>parseFavoriteStoreState(await webRequest(a,"?storeId="+id+"&favorite="+favorite,signal,true),a,id,favorite),
    (a,b)=>setCustomerFavoriteStore(nativeOwner??"",b,a,id,favorite,signal),true);
}
