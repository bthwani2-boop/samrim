import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../../src/server/security/csrf";
const headers = { "Cache-Control": "no-store" };
function failure(code:string,message:string,status:number) {return NextResponse.json({error:{code,message}},{status,headers});}
export async function POST(request:Request,context:Readonly<{params:Promise<{orderId:string;caseId:string}>}>) {
 if(!verifySameOrigin(request))return failure("FORBIDDEN","cross-origin request",403);
 const identity=await readOperatorSession();
 if(!identity)return failure("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator")return failure("FORBIDDEN","operator access required",403);
 const denied=operatorWorkspacePermissionDenied(identity,"operations");
 if(denied)return denied;
 const {orderId,caseId}=await context.params;
 const body=await request.json().catch(()=>null) as {action?:unknown;note?:unknown;expectedVersion?:unknown}|null;
 const key=request.headers.get("Idempotency-Key")?.trim()||randomUUID();
 if(!orderId?.trim()||orderId.length>128||!caseId||!/^[1-9]\d{0,18}$/.test(caseId)||
   !body||typeof body.action!=="string"||!["CLAIM","ACTION_REQUIRED","NEXT_ACTION","RESOLVE"].includes(body.action)||
   typeof body.expectedVersion!=="number"||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1||
   (typeof body.note!=="undefined"&&typeof body.note!=="string")||
   (typeof body.note==="string"&&body.note.length>1000)||key.length<8||key.length>128) {
    return failure("INVALID_INPUT","invalid case transition",400);
 }
 try{
   const result=await requestDshJson("POST",`/dsh/operator/operations/${encodeURIComponent(orderId)}/cases/${caseId}/transition`,
    {action:body.action,note:typeof body.note==="string"?body.note.trim():"",expectedVersion:body.expectedVersion},
    {"X-Acting-Actor-ID":identity.subject,"Idempotency-Key":key,
     "X-Correlation-ID":request.headers.get("X-Correlation-ID")?.trim()||randomUUID()});
   return NextResponse.json(result.payload,{status:result.status,headers});
 }catch(error){
   if(!isDshClientError(error))return failure("INTERNAL_ERROR","case decision unknown; read current state before retry",500);
   const detail=dshErrorPayload(error);
   return failure(detail.code,detail.message,dshHttpStatus(error));
 }
}
