import {
  changeMerchantStoreProfile, confirmMerchantStoreProfileResult, DshPublicError, getMerchantStoreProfile,
  type MerchantStoreProfile, type MerchantStoreProfileChange, type MerchantStoreProfileResult, parseMerchantStoreProfile,
  validMerchantStoreProfileChange,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";
import { requestMerchantOwnerDocument } from "../access/merchant-owner-web.ts";

function requireScope(storeId: string, actorId: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId) throw new DshPublicError(400,"INVALID_STORE_PROFILE");
}
export async function readStoreProfile(storeId: string, actorId: string, signal: AbortSignal): Promise<MerchantStoreProfile> {
  requireScope(storeId,actorId);
  signal.throwIfAborted();
  if (Platform.OS !== "web") return withNativeMerchantSession(signal,(bearer,origin)=>
    getMerchantStoreProfile(origin,storeId,actorId,bearer,signal),actorId);
  const {document}=await requestMerchantOwnerDocument({query:new URLSearchParams({profile:storeId}),actorId,method:"GET",signal,byteLimit:16*1024});
  if(Object.keys(document).length!==1 || !Object.hasOwn(document,"profile")) throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return parseMerchantStoreProfile(document.profile,storeId,actorId);
}
export async function saveStoreProfile(storeId:string,actorId:string,change:MerchantStoreProfileChange,signal:AbortSignal):Promise<MerchantStoreProfileResult> {
  requireScope(storeId,actorId);
  if(!validMerchantStoreProfileChange(change)) throw new DshPublicError(400,"INVALID_STORE_PROFILE");
  signal.throwIfAborted();
  if(Platform.OS!=="web") return withNativeMerchantSession(signal,(bearer,origin)=>
    changeMerchantStoreProfile(origin,storeId,actorId,bearer,change,signal),actorId,true);
  const {document}=await requestMerchantOwnerDocument({query:new URLSearchParams({profile:storeId}),actorId,method:"PATCH",signal,change,byteLimit:16*1024});
  return confirmMerchantStoreProfileResult(document,storeId,actorId,change);
}
