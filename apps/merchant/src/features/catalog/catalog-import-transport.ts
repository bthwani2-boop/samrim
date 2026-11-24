import { DshPublicError, type MerchantCatalogImportChange, type MerchantCatalogImportResult, merchantCatalogImport, parseMerchantCatalogImportResult, validMerchantCatalogImportChange } from "@bthwani/dsh";
import { Platform } from "react-native";
import { withNativeMerchantSession } from "../access/admission-transport";

export async function requestCatalogImport(actorId:string,storeId:string,runId:string,method:"GET"|"PUT"|"PATCH",
  signal:AbortSignal,change?:MerchantCatalogImportChange,offset=0):Promise<MerchantCatalogImportResult>{
  if(!actorId||!/^[a-z0-9-]{1,64}$/.test(storeId)||!/^[A-Za-z0-9._-]{8,128}$/.test(runId)||
    !Number.isSafeInteger(offset)||offset<0||offset>5000||(method!=="GET"&&offset!==0)||
    (method==="PUT"?!validMerchantCatalogImportChange(change):change!==undefined))throw new DshPublicError(400,"INVALID_REQUEST");
  signal.throwIfAborted();
  if(Platform.OS!=="web")return withNativeMerchantSession(signal,(bearer,origin)=>
    merchantCatalogImport(origin,actorId,storeId,runId,bearer,method,signal,change,offset),actorId,method!=="GET");
  const query=new URLSearchParams({catalogImport:storeId,run:runId});
  if(method==="GET"&&offset)query.set("offset",String(offset));
  const response=await fetch("/api/admission?"+query,{method,signal,credentials:"same-origin",cache:"no-store",redirect:"error",
    headers:{"X-Merchant-Context":actorId,...(change?{"Content-Type":"application/json"}:{})},
    ...(change?{body:JSON.stringify(change)}:{})});
  const payload:unknown=await response.json();
  signal.throwIfAborted();
  const data=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload as Record<string,unknown>:{};
  if(!response.ok)throw new DshPublicError(response.status,typeof data.code==="string"?data.code:"OWNER_UNAVAILABLE");
  if(response.status!==200||!response.headers.get("Cache-Control")?.toLowerCase().split(",").some(x=>x.trim()==="no-store"))
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  const result=parseMerchantCatalogImportResult(data.catalogImport,actorId,storeId,runId);
  if((change&&(result.sourceSha256!==change.sourceSha256||result.total!==change.rows.length))||
    (method==="GET"&&result.offset!==Math.min(offset,result.processed)))throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return result;
}
