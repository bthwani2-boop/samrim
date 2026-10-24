import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const noStore={"Cache-Control":"no-store"};
function errorResponse(code:string,status:number){
 return NextResponse.json({error:{code,message:"تعذّر اعتماد السياسة أو قراءتها. تحقّق من الصلاحيات والحالة."}},{status,headers:noStore});
}
async function authorize(){
 const identity=await readOperatorSession();
 if(!identity)return {error:errorResponse("UNAUTHENTICATED",401)} as const;
 if(identity.role!=="operator")return {error:errorResponse("FORBIDDEN",403)} as const;
 const denied=operatorWorkspacePermissionDenied(identity,"platform_policies");
 if(denied)return {error:denied} as const;
 return {actor:identity.subject} as const;
}
export async function GET(){
 const access=await authorize();
 if("error" in access)return access.error;
 try{
  const {payload}=await requestDshJson("GET","/dsh/operator/stage-sla-policies",undefined,{"X-Acting-Actor-ID":access.actor});
  return NextResponse.json(payload,{headers:noStore});
 }catch(e){
  if(!isDshClientError(e))return errorResponse("OUTCOME_UNKNOWN",503);
  const detail=dshErrorPayload(e);
  return NextResponse.json({error:detail},{status:dshHttpStatus(e),headers:noStore});
 }
}
export async function POST(request:Request){
 if(!verifySameOrigin(request))return errorResponse("FORBIDDEN",403);
 const access=await authorize();
 if("error" in access)return access.error;
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||!["BTHWANI_CAPTAIN","PARTNER_CAPTAIN","CUSTOMER_PICKUP"].includes(String(body.fulfillmentMode))
  ||!["CREATED","PARTNER_ACCEPTED","PREPARING","READY_FOR_DISPATCH","READY_FOR_PICKUP","CAPTAIN_ASSIGNED","IN_CUSTODY"].includes(String(body.stage))
  ||!Number.isSafeInteger(body.targetMinutes)||Number(body.targetMinutes)<1||Number(body.targetMinutes)>1440
  ||!Number.isSafeInteger(body.warningMinutes)||Number(body.warningMinutes)<0||Number(body.warningMinutes)>=Number(body.targetMinutes)
  ||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<0)return errorResponse("INVALID_INPUT",400);
 const key=request.headers.get("Idempotency-Key")?.trim()||randomUUID();
 if(key.length<8||key.length>128)return errorResponse("INVALID_INPUT",400);
 try{
  const result=await requestDshJson("POST","/dsh/operator/stage-sla-policies",body,{
   "X-Acting-Actor-ID":access.actor,"Idempotency-Key":key,"X-Correlation-ID":request.headers.get("X-Correlation-ID")?.trim()||randomUUID()
  });
  return NextResponse.json(result.payload,{status:result.status,headers:noStore});
 }catch(e){
  if(!isDshClientError(e))return errorResponse("OUTCOME_UNKNOWN",503);
  const detail=dshErrorPayload(e);
  return NextResponse.json({error:detail},{status:dshHttpStatus(e),headers:noStore});
 }
}
