import { type CustomerAddressChange, type CustomerAddressPage, type CustomerAddressResult, type DeliveryServiceability, DshPublicError, evaluateDeliveryServiceability,
  getCustomerAddress, isCustomerAddressId, listCustomerAddresses, normalizeCustomerAddressChange, parseCustomerAddress, parseCustomerAddressPage, parseCustomerAddressResult, parseDeliveryServiceability, saveCustomerAddress } from "@bthwani/dsh";
import { Platform } from "react-native";
import { discardCustomerResponse, readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOwner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route = "/api/customer-auth/addresses";
export async function verifyAddressSession(signal: AbortSignal, actor?: string) {
  const state = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!state.enabled || state.session?.role !== "customer" ||
    (actor !== undefined && actor !== state.session.actorId) || !(Date.parse(state.session.sessionExpiresAt) > Date.now())) {
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
  if (signal.aborted || res.status !== 200 || res.headers.get("Cache-Control") !== "no-store") {
    discardCustomerResponse(res);
    signal.throwIfAborted();
    if (!res.ok) throw new DshPublicError(res.status,mutating && res.status>=500?"OPERATION_RESULT_UNKNOWN":"ADDRESS_REQUEST_REJECTED");
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  const body = await readBoundedCustomerJSON({ headers: res.headers, body: res.body, signal }, 32 * 1024);
  if (body === null) {
    discardCustomerResponse(res);
    signal.throwIfAborted();
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  }
  signal.throwIfAborted();
  return body;
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
export async function readVerifiedAddress(signal: AbortSignal, actor: string, id: string) {
  if (!isCustomerAddressId(id)) throw new DshPublicError(400,"INVALID_REQUEST");
  const before = await verifyAddressSession(signal,actor);
  const expiresAt = Date.parse(before.sessionExpiresAt);
  try {
    if (Platform.OS === "web") {
      const value = parseCustomerAddress(await webRead(`${route}?addressId=${encodeURIComponent(id)}`,actor,signal),actor,id);
      const current = await verifyAddressSession(signal,actor);
      return {address:value.address,expiresAt:Math.min(expiresAt,Date.parse(current.sessionExpiresAt))};
    }
    if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
    const result = await withVerifiedNativeCustomerRead(signal,bearer=>getCustomerAddress(nativeOwner,bearer,actor,id,signal),actor);
    if (result.kind !== "ready") throw new DshPublicError(result.kind === "signed-out" ? 401 : 503,"OWNER_UNAVAILABLE");
    signal.throwIfAborted();
    return {address:result.value.address,expiresAt:Math.min(expiresAt,result.expiresAt)};
  } catch (error) {
    // The screen may keep its already verified page when the selected address is gone.
    if (error instanceof DshPublicError && error.status === 404) await verifyAddressSession(signal,actor);
    throw error;
  }
}
export async function writeVerifiedAddress(actor:string,id:string,change:CustomerAddressChange,signal:AbortSignal):Promise<CustomerAddressResult> {
  const command=normalizeCustomerAddressChange(change);
  if(!command||!isCustomerAddressId(id))throw new DshPublicError(400,"INVALID_REQUEST");
  await verifyAddressSession(signal,actor);
  let dispatched=false;
  try {
    if (Platform.OS==="web") {
      dispatched=true;
      const result=parseCustomerAddressResult(await webRead(`${route}?addressId=${encodeURIComponent(id)}`,actor,signal,command),actor,id,command);
      await verifyAddressSession(signal,actor);
      return result;
    }
    if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
    const result=await withVerifiedNativeCustomerRead(signal,bearer=>{
      dispatched=true;
      return saveCustomerAddress(nativeOwner,bearer,actor,id,command,signal);
    },actor);
    if (result.kind!=="ready") throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
    signal.throwIfAborted();
    return result.value;
  } catch(error) {
    if (dispatched && (!(error instanceof DshPublicError) || ![400,404,409].includes(error.status))) {
      throw new DshPublicError(503,"OPERATION_RESULT_UNKNOWN");
    }
    throw error;
  }
}

export async function readVerifiedDeliveryServiceability(actor:string,store:string,address:string,signal:AbortSignal):Promise<DeliveryServiceability> {
  await verifyAddressSession(signal,actor);
  if (Platform.OS==="web") {
    const value=parseDeliveryServiceability(await webRead(
      `/api/customer-auth/serviceability?storeId=${encodeURIComponent(store)}&addressId=${encodeURIComponent(address)}`,actor,signal),actor,store,address);
    await verifyAddressSession(signal,actor);
    return value;
  }
  if (!nativeOwner) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
  const result=await withVerifiedNativeCustomerRead(signal,bearer=>evaluateDeliveryServiceability(nativeOwner,bearer,actor,store,address,signal),actor);
  if (result.kind!=="ready") throw new DshPublicError(result.kind==="signed-out"?401:503,"OWNER_UNAVAILABLE");
  signal.throwIfAborted();
  return result.value;
}
