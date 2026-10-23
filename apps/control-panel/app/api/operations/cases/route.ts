import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";

const headers={"Cache-Control":"no-store"};
function failure(code:string,message:string,status:number){
 return NextResponse.json({error:{code,message}},{status,headers});
}
export async function GET(request:Request){
 const identity=await readOperatorSession();
 if(!identity)return failure("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator")return failure("FORBIDDEN","operator access required",403);
 const denied=operatorWorkspacePermissionDenied(identity,"operations");
 if(denied)return denied;
 const params=new URL(request.url).searchParams;
 const limit=params.get("limit")??"15";
 const scope=params.get("scope")??"all";
 const cursor=params.get("cursor")??"";
 if(!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>30||
   !["all","mine","unassigned"].includes(scope)||cursor.length>512){
  return failure("INVALID_INPUT","invalid case queue filter",400);
 }
 const query=new URLSearchParams({limit,scope});
 if(cursor)query.set("cursor",cursor);
 try{
  const {payload}=await requestDshJson("GET",
   `/dsh/operator/operational-cases?${query.toString()}`,undefined,
   {"X-Acting-Actor-ID":identity.subject});
  return NextResponse.json(payload,{headers});
 }catch(error){
  if(!isDshClientError(error))return failure("INTERNAL_ERROR","case queue unavailable",500);
  const detail=dshErrorPayload(error);
  return failure(detail.code,detail.message,dshHttpStatus(error));
 }
}
