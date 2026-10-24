import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,requestDshJson } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../../src/server/identity/operator-workspace-access";

const headers={"Cache-Control":"no-store"};
function failure(code:string,message:string,status:number) {
 return NextResponse.json({error:{code,message}},{status,headers});
}
export async function GET(_request:Request,context:Readonly<{params:Promise<{orderId:string;caseId:string}>}>) {
 const identity=await readOperatorSession();
 if(!identity)return failure("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator")return failure("FORBIDDEN","operator access required",403);
 const denied=operatorWorkspacePermissionDenied(identity,"operations");
 if(denied)return denied;
 const {orderId,caseId}=await context.params;
 if(!orderId?.trim()||orderId.length>128||!caseId||!/^[1-9]\d{0,18}$/.test(caseId)){
   return failure("INVALID_INPUT","invalid case",400);
 }
 try{
  const {payload}=await requestDshJson("GET",
   "/dsh/operator/operations/"+encodeURIComponent(orderId)+"/cases/"+caseId+"/resolution-evidence",
   undefined,{"X-Acting-Actor-ID":identity.subject});
  return NextResponse.json(payload,{headers});
 }catch(error){
  if(!isDshClientError(error))return failure("INTERNAL_ERROR","case proof unavailable",500);
  const detail=dshErrorPayload(error);
  return failure(detail.code,detail.message,dshHttpStatus(error));
 }
}
