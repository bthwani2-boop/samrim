import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listHRAccessRequests } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";

export async function GET(request: Request) {
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.canManageOperatorPermissions)return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const cursor=new URL(request.url).searchParams.get("cursor")??"";
 if(cursor.length>1024)return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try{
  const page=await listHRAccessRequests({operatorActorId:identity.subject},"",cursor);
  return NextResponse.json(page,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(!isDshClientError(error))return NextResponse.json({error:{code:"UNAVAILABLE"}},{status:502});
  return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
 }
}
