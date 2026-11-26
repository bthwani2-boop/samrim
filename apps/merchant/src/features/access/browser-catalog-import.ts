import { merchantCatalogImport, validMerchantCatalogImportChange } from "@bthwani/dsh";
import { readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerFrom, configuredOrigin, isLocalMutation, ownerError, readMutationBody, response, standingOrigin } from "./browser-admission-http.ts";

export async function catalogImportAdmission(request:Request) {
  const method=request.method;
  if(method!=="GET"&&method!=="PUT"&&method!=="PATCH")return response({code:"INVALID_REQUEST"},400);
  if(method!=="GET"&&!isLocalMutation(request))return response({code:"FORBIDDEN"},403);
  const q=new URL(request.url).searchParams, store=q.get("catalogImport")??"", run=q.get("run")??"", raw=q.get("offset");
  const offset=raw===null?0:Number(raw);
  if(!/^[a-z0-9-]{1,64}$/.test(store)||!/^[A-Za-z0-9._-]{8,128}$/.test(run)||
    [...q.keys()].some(k=>!["catalogImport","run",...(method==="GET"?["offset"]:[])].includes(k)||q.getAll(k).length!==1)||
    !Number.isInteger(offset)||offset<0||offset>5000||(raw!==null&&String(offset)!==raw))return response({code:"INVALID_REQUEST"},400);
  const actor=request.headers.get("X-Merchant-Context"),bearer=bearerFrom(request);
  if(!bearer)return response({code:"UNAUTHENTICATED"},401);
  if(!actor)return response({code:"MERCHANT_CONTEXT_CHANGED"},403);
  const origin=await configuredOrigin(request);
  if(!origin)return response({code:"OWNER_UNAVAILABLE"},503);
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]);
    const session=await readVerifiedIdentitySession(origin,bearer,signal);
    if(session.role!=="merchant"||session.actorId!==actor)return response({code:"MERCHANT_CONTEXT_CHANGED"},403);
    const change=method==="PUT"?await readMutationBody(request,8*1024*1024):undefined;
    if(method==="PUT"&&!validMerchantCatalogImportChange(change))return response({code:"INVALID_REQUEST"},400);
    if(method!=="PUT"&&request.body!==null)return response({code:"INVALID_REQUEST"},400);
    const result=await merchantCatalogImport(standingOrigin(origin),actor,store,run,bearer,method,signal,
      validMerchantCatalogImportChange(change)?change:undefined,offset);
    const current=await readVerifiedIdentitySession(origin,bearer,signal);
    if(current.role!=="merchant"||current.actorId!==actor)return response({code:"MERCHANT_CONTEXT_CHANGED"},403);
    return response({catalogImport:result});
  }catch(error){return ownerError(error);}
}
