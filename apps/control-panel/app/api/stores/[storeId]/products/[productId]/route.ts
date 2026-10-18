import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,readOperatorStoreProduct,updateOperatorStoreProduct } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";
const fail=(code:string,message:string,status:number)=>NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}});
async function access(request:Request){
  if(!verifySameOrigin(request))return {response:fail("FORBIDDEN","Cross-origin request",403)};
  const identity=await readOperatorSession();
  if(!identity)return {response:fail("UNAUTHENTICATED","Authentication required",401)};
  if(identity.role!=="operator")return {response:fail("FORBIDDEN","Operator only",403)};
  const denied=operatorWorkspacePermissionDenied(identity,"partners");
  if(denied)return {response:denied};
  return {actorId:identity.subject};
}
const handle=(cause:unknown)=>{if(isDshClientError(cause)){const value=dshErrorPayload(cause);return fail(value.code,value.message,dshHttpStatus(cause))}return fail("INTERNAL_ERROR","Store product operation failed",500)};
export async function GET(request:Request,ctx:{params:Promise<{storeId:string;productId:string}>}){
  const permission=await access(request);if(permission.response)return permission.response;
  const {storeId,productId}=await ctx.params;
  if(!storeId||storeId.length>128||!productId||productId.length>128)return fail("INVALID_INPUT","Invalid Store product",400);
  try{return NextResponse.json(await readOperatorStoreProduct(storeId,productId,{operatorActorId:permission.actorId!}),{headers:{"Cache-Control":"no-store"}})}
  catch(cause){return handle(cause)}
}
export async function PATCH(request:Request,ctx:{params:Promise<{storeId:string;productId:string}>}){
  const permission=await access(request);if(permission.response)return permission.response;
  const {storeId,productId}=await ctx.params;
  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  const expectedVersion=Number(request.headers.get("X-Expected-Version"));
  if(!storeId||!productId||idempotencyKey.length<8||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)return fail("INVALID_INPUT","Product, version or mutation key invalid",400);
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||input.scope!=="STORE_SCOPED"||typeof input.canonicalName!=="string"||!input.canonicalName.trim())return fail("INVALID_INPUT","Invalid Store product update",400);
  try{const result=await updateOperatorStoreProduct(storeId,productId,input,{operatorActorId:permission.actorId!,idempotencyKey,expectedVersion,correlationId:request.headers.get("X-Correlation-ID")?.trim()||randomUUID()});return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}})}
  catch(cause){return handle(cause)}
}
