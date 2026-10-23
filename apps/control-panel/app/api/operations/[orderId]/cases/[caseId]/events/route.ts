import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,requestDshJson } from "../../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../../src/server/identity/operator-workspace-access";

const headers = { "Cache-Control": "no-store" };
function failure(code:string,message:string,status:number){
 return NextResponse.json({error:{code,message}},{status,headers});
}
export async function GET(request:Request,context:Readonly<{params:Promise<{orderId:string;caseId:string}>}>){
 const identity=await readOperatorSession();
 if(!identity)return failure("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator")return failure("FORBIDDEN","operator access required",403);
 const denied=operatorWorkspacePermissionDenied(identity,"operations");
 if(denied)return denied;
 const {orderId,caseId}=await context.params;
 const params=new URL(request.url).searchParams;
 const limit=params.get("limit")??"15";
 const cursor=params.get("cursor")??"";
 if(!orderId?.trim()||orderId.length>128||!caseId||!/^[1-9]\d{0,18}$/.test(caseId)||
   !/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>30||
   (cursor&&!/^[1-9]\d{0,18}$/.test(cursor))){
  return failure("INVALID_INPUT","invalid case audit query",400);
 }
 const query=new URLSearchParams({limit});
 if(cursor)query.set("cursor",cursor);
 try{
  const {payload}=await requestDshJson("GET",
   `/dsh/operator/operations/${encodeURIComponent(orderId)}/cases/${caseId}/events?${query.toString()}`,
   undefined,{"X-Acting-Actor-ID":identity.subject});
  return NextResponse.json(payload,{headers});
 }catch(error){
  if(!isDshClientError(error))return failure("INTERNAL_ERROR","case audit unavailable",500);
  const detail=dshErrorPayload(error);
  return failure(detail.code,detail.message,dshHttpStatus(error));
 }
}
