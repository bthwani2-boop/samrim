import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../../src/server/dsh/dsh-bff";
import { currentOperatorAccessTokenForDsh, readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

const noStore={ "Cache-Control":"no-store" };
function failure(code:string,message:string,status:number){
  return NextResponse.json({error:{code,message}},{status,headers:noStore});
}
export async function POST(request:Request,context:{params:Promise<{orderId:string}>}){
  if(!verifySameOrigin(request))return failure("FORBIDDEN","cross-site request forbidden",403);
  const actor=await readOperatorSession();
  if(!actor||actor.role!=="operator"||operatorWorkspacePermissionDenied(actor,"operations"))
    return failure("FORBIDDEN","operator operations access required",403);
  const token=await currentOperatorAccessTokenForDsh();
  if(!token)return failure("UNAUTHENTICATED","operator session required",401);
  const {orderId}=await context.params;
  const input=await request.json().catch(()=>null) as {messageId?:unknown}|null;
  const messageId=typeof input?.messageId==="string"?input.messageId.trim():"";
  if(!orderId||orderId.length>128||!messageId||messageId.length>128)
    return failure("INVALID_INPUT","order and message ID required",400);
  try{
    const response=await requestDshJson("POST",`/dsh/orders/${encodeURIComponent(orderId)}/conversation/read`,
      {messageId},{"X-Correlation-ID":randomUUID()},token);
    return NextResponse.json(response.payload,{status:response.status,headers:noStore});
  }catch(error){
    const payload=dshErrorPayload(error);
    return failure(payload.code,payload.message,isDshClientError(error)?dshHttpStatus(error):500);
  }
}
