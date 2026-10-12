import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,listHREmployeeEvents } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";

export async function GET(request:Request,context:{params:Promise<{employeeId:string}>}){
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.permissions?.includes("hr"))
  return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const id=(await context.params).employeeId;
 const cursor=new URL(request.url).searchParams.get("cursor")??"";
 if(!/^emp_[a-f0-9]{32}$/.test(id)||cursor.length>1024)return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try{
  const page=await listHREmployeeEvents(id,cursor,{operatorActorId:identity.subject});
  return NextResponse.json(page,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(!isDshClientError(error))return NextResponse.json({error:{code:"HR_UNAVAILABLE"}},{status:502});
  return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error),headers:{"Cache-Control":"no-store"}});
 }
}
