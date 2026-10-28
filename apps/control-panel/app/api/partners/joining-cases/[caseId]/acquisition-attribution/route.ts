import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { attributeJoiningCaseAcquisition, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function failure(code:string,message:string,status:number){
  return NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request,context:{params:Promise<{caseId:string}>}){
  if(!verifySameOrigin(request))return failure("FORBIDDEN","cross-site requests are forbidden",403);
  const identity=await readOperatorSession();
  if(!identity)return failure("UNAUTHENTICATED","authentication is required",401);
  if(identity.role!=="operator")return failure("FORBIDDEN","operator role is required",403);
  const denied=operatorWorkspacePermissionDenied(identity,"partners");
  if(denied)return denied;
  const {caseId}=await context.params;
  const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
  const correlationId=request.headers.get("X-Correlation-ID")?.trim()||randomUUID();
  const input=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!caseId || caseId.length>128 || idempotencyKey.length<8 || idempotencyKey.length>128 || correlationId.length<8 || correlationId.length>128 ||
    !input || Object.keys(input).some(key=>!["fieldActorId","reason","expectedVersion"].includes(key)) ||
    typeof input.fieldActorId!=="string" || !input.fieldActorId.trim() || input.fieldActorId.trim().length>128 ||
    typeof input.reason!=="string" || Array.from(input.reason.trim()).length<8 || Array.from(input.reason.trim()).length>400 ||
    typeof input.expectedVersion!=="number" || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1){
    return failure("INVALID_INPUT","joining-case attribution is invalid",400);
  }
  try{
    const result=await attributeJoiningCaseAcquisition(caseId,input.fieldActorId,input.reason,input.expectedVersion,{
      operatorActorId:identity.subject,correlationId,idempotencyKey
    });
    return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(!isDshClientError(error))return failure("INTERNAL_ERROR","joining-case attribution failed",500);
    const detail=dshErrorPayload(error);
    return failure(detail.code,detail.message,dshHttpStatus(error));
  }
}
