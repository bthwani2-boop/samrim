import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CustomerCartDirectoryEntry = Readonly<{storeId:string;storeName:string;version:number;lineCount:number}>;
export type CustomerCartDirectory = Readonly<{actorId:string;carts:CustomerCartDirectoryEntry[];nextCursor?:string}>;
const storeRule=/^[a-z0-9-]{1,64}$/;
const bearerRule=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const obj=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const invalid=():never=>{throw new DshPublicError(502,"OWNER_RESPONSE_INVALID");};

export function parseCustomerCartDirectory(value:unknown,actor:string,after=""):CustomerCartDirectory {
  if(!obj(value)||!exact(value,value.nextCursor===undefined?["actorId","carts"]:["actorId","carts","nextCursor"])||
    value.actorId!==actor||!Array.isArray(value.carts)||value.carts.length>20) return invalid();
  let previous=after;
  for(const row of value.carts){
    if(!obj(row)||!exact(row,["storeId","storeName","version","lineCount"])||
      typeof row.storeId!=="string"||!storeRule.test(row.storeId)||row.storeId<=previous||
      typeof row.storeName!=="string"||Array.from(row.storeName).length>120||
      !Number.isSafeInteger(row.version)||(row.version as number)<1||
      !Number.isSafeInteger(row.lineCount)||(row.lineCount as number)<1||(row.lineCount as number)>20) return invalid();
    previous=row.storeId;
  }
  if(value.nextCursor!==undefined&&(value.carts.length!==20||value.nextCursor!==previous)) return invalid();
  return value as CustomerCartDirectory;
}
export async function listCurrentCustomerCarts(origin:string,bearer:string,actor:string,after?:string,signal?:AbortSignal):Promise<CustomerCartDirectory>{
  if(!bearerRule.test(bearer)||!actor||actor.trim()!==actor||actor.length>128) throw new DshPublicError(401,"UNAUTHENTICATED");
  if(after!==undefined&&!storeRule.test(after)) throw new DshPublicError(400,"INVALID_REQUEST");
  const match=/^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):([1-9][0-9]{0,4})$/.exec(origin);
  if(!match||Number(match[1])>65535) throw new DshPublicError(503,"OWNER_UNAVAILABLE");
  const path=dshOperations.listCurrentCustomerCarts.path;
  return parseCustomerCartDirectory(await privateOwnerRequest(origin,after?path+"?after="+after:path,bearer,"GET",undefined,signal),actor,after);
}