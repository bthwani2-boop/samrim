import { type CustomerAddressChange, type CustomerAddressPage, type CustomerAddressResult, DshPublicError,
  listCustomerAddresses, parseCustomerAddressPage, parseCustomerAddressResult, saveCustomerAddress } from "@bthwani/dsh";
import { Platform } from "react-native";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOwner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route = "/api/customer-auth/addresses";
export async function verifyAddressSession(signal: AbortSignal, actor?: string) {
  const state = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!state.enabled || state.session?.role !== "customer" ||
    (actor !== undefined && actor !== state.session.actorId) || Date.parse(state.session.sessionExpiresAt) <= Date.now()) {
    throw new DshPublicError(401,"UNAUTHORIZED");
  }
  return state.session;
}
async function webRead(path: string,actor: string,signal: AbortSignal,change?: CustomerAddressChange): Promise<unknown> {
  const mutating = change !== undefined;
  let res: Response;
  try {
    res = await fetch(path,{method:mutating?"PUT":"GET",credentials:"same-origin",redirect:"error",cache:"no-store",signal,
      headers:{"X-Customer-Context":actor,...(mutating?{"Content-Type":"application/json"}:{})},
      ...(mutating?{body:JSON.stringify(change)}:{})});
  } catch { throw new DshPublicError(503,mutating?"OPERATION_RESULT_UNKNOWN":"OWNER_UNAVAILABLE"); }
  signal.throwIfAborted();
  if (!res.ok) throw new DshPublicError(res.status,mutating && res.status>=500?"OPERATION_RESULT_UNKNOWN":"ADDRESS_REQUEST_REJECTED");
  if (res.headers.get("Cache-Control") !== "no-store") throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return await res.json();
}
export async function readVerifiedAddresses(signal: AbortSignal,actor?: string,after?: string):
Promise<{page:CustomerAddressPage;expiresAt:number}> {
  const before=await verifyAddressSession(signal,actor);
  let page:CustomerAddressPage;
  let expiresAt=Date.parse(before.sessionExpiresAt);
  if (Platform.OS === "web") {
    const payload=await webRead(after?`${route}?after=${encodeURIComponent(after)}`:route,before.actorId,signal);
    page=parseCustomerAddressPage(payload,before.actorId,after);
    const current=await verifyAddressSession(signal,before.actorId);
    expiresAt=Math.min(expiresAt,Date.parse(current.sessionExpiresAt));
  } else {
    if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
    const result=await withVerifiedNativeCustomerRead(signal,bearer=>listCustomerAddresses(nativeOwner,bearer,before.actorId,after,signal),before.actorId);
    if (result.kind!=="ready") throw new DshPublicError(result.kind==="signed-out"?401:503,"OWNER_UNAVAILABLE");
    page=result.value;
    expiresAt=Math.min(expiresAt,result.expiresAt);
  }
  signal.throwIfAborted();
  return {page,expiresAt};
}
export async function writeVerifiedAddress(actor:string,id:string,change:CustomerAddressChange,signal:AbortSignal):Promise<CustomerAddressResult> {
  await verifyAddressSession(signal,actor);
  let dispatched=false;
  try {
    if (Platform.OS==="web") {
      dispatched=true;
      const result=parseCustomerAddressResult(await webRead(`${route}?addressId=${encodeURIComponent(id)}`,actor,signal,change),actor,id,change);
      await verifyAddressSession(signal,actor);
      return result;
    }
    if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
    const result=await withVerifiedNativeCustomerRead(signal,bearer=>{
      dispatched=true;
      return saveCustomerAddress(nativeOwner,bearer,actor,id,change,signal);
    },actor);
    if (result.kind!=="ready") throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
    return result.value;
  } catch(error) {
    if (dispatched && (!(error instanceof DshPublicError) || ![400,404,409].includes(error.status))) {
      throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
    }
    throw error;
  }
}
