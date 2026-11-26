import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type MerchantCatalogImportRow = Readonly<{row:number;name:string;priceYer:string;stockUnits:string;offerId?:string;expectedVersion?:number;sourceIssue?:"INVALID_ROW"}>;
export type MerchantCatalogImportChange = Readonly<{sourceSha256:string;rows:readonly MerchantCatalogImportRow[]}>;
export type MerchantCatalogImportOutcome = Readonly<{row:number;status:"ACCEPTED"|"HELD"|"FAILED";reason:string;offerId?:string;resultVersion?:number}>;
export type MerchantCatalogImportResult = Readonly<{actorId:string;storeId:string;runId:string;sourceSha256:string;total:number;processed:number;offset:number;outcomes:MerchantCatalogImportOutcome[]}>;
const id=/^[a-z0-9-]{1,64}$/;
const run=/^[A-Za-z0-9._-]{8,128}$/;
const digest=/^[a-f0-9]{64}$/;
const obj=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const string=(v:unknown,max:number):v is string=>typeof v==="string"&&!v.includes(String.fromCharCode(0))&&!/[\uD800-\uDFFF]/u.test(v)&&new TextEncoder().encode(v).length<=max;
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validMerchantCatalogImportChange(input:unknown):input is MerchantCatalogImportChange {
  const v=obj(input);
  return !!v&&exact(v,["sourceSha256","rows"])&&typeof v.sourceSha256==="string"&&digest.test(v.sourceSha256)&&
    Array.isArray(v.rows)&&v.rows.length>=1&&v.rows.length<=5000&&v.rows.every((raw,i)=>{
      const r=obj(raw);if(!r)return false;
      const selected=r.offerId!==undefined;
      const invalid=r.sourceIssue!==undefined;
      return exact(r,invalid?["row","name","priceYer","stockUnits","sourceIssue"]:selected?["row","name","priceYer","stockUnits","offerId","expectedVersion"]:["row","name","priceYer","stockUnits"])&&
        (!invalid||(r.sourceIssue==="INVALID_ROW"&&!selected))&&
        r.row===i+2&&string(r.name,4096)&&string(r.priceYer,128)&&string(r.stockUnits,128)&&
        (!selected||(typeof r.offerId==="string"&&id.test(r.offerId)&&integer(r.expectedVersion,1,Number.MAX_SAFE_INTEGER-1)));
    })&&new TextEncoder().encode(JSON.stringify(input)).length<=8*1024*1024;
}
export function parseMerchantCatalogImportResult(payload:unknown,actorId:string,storeId:string,runId:string):MerchantCatalogImportResult {
  const v=obj(payload);
  if(!v||!exact(v,["actorId","storeId","runId","sourceSha256","total","processed","offset","outcomes"])||
    v.actorId!==actorId||v.storeId!==storeId||v.runId!==runId||typeof v.sourceSha256!=="string"||!digest.test(v.sourceSha256)||
    !integer(v.total,1,5000)||!integer(v.processed,0,v.total)||!integer(v.offset,0,v.processed)||!Array.isArray(v.outcomes))
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  const offset=v.offset,processed=v.processed;
  if(v.outcomes.length!==Math.min(25,processed-offset)||!v.outcomes.every((raw,i)=>{
    const r=obj(raw);if(!r||r.row!==offset+i+2)return false;
    if(r.status==="ACCEPTED")return exact(r,["row","status","reason","offerId","resultVersion"])&&r.reason==="UPDATED"&&typeof r.offerId==="string"&&id.test(r.offerId)&&integer(r.resultVersion,2,Number.MAX_SAFE_INTEGER);
    return exact(r,["row","status","reason"])&&(r.status==="FAILED"?r.reason==="OPERATION_CONFLICT":r.status==="HELD"&&["UNSELECTED","DUPLICATE","INVALID_VALUES","AMBIGUOUS_OR_CHANGED","INELIGIBLE","STALE_VERSION_OR_NAME"].includes(String(r.reason)));
  }))throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return v as MerchantCatalogImportResult;
}
export async function merchantCatalogImport(origin:string,actorId:string,storeId:string,runId:string,bearer:string,method:"GET"|"PUT"|"PATCH",signal:AbortSignal,change?:MerchantCatalogImportChange,offset=0):Promise<MerchantCatalogImportResult>{
  if(!actorId||!id.test(storeId)||!run.test(runId)||!integer(offset,0,5000)||(method!=="GET"&&offset!==0)||
    (method==="PUT"?!validMerchantCatalogImportChange(change):change!==undefined))throw new DshPublicError(400,"INVALID_REQUEST");
  const operation=method==="GET"?dshOperations.readMerchantCatalogImport:method==="PUT"?dshOperations.startMerchantCatalogImport:dshOperations.advanceMerchantCatalogImport;
  const path=operation.path.replace("{storeID}",storeId).replace("{runID}",runId)+(method==="GET"&&offset?"?offset="+offset:"");
  const result=parseMerchantCatalogImportResult(await privateOwnerRequest(origin,path,bearer,method,change,signal),actorId,storeId,runId);
  if((change&&(result.sourceSha256!==change.sourceSha256||result.total!==change.rows.length))||(method==="GET"&&result.offset!==Math.min(offset,result.processed)))
    throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");
  return result;
}
