import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,listHRAttendance,recordHRAttendance,type HRAttendanceInput } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

type Context={params:Promise<{employeeId:string}>};
const fail=(status:number,code:string)=>NextResponse.json({error:{code}},{status,headers:{"Cache-Control":"no-store"}});
async function authorized(id:string){
 const session=await readOperatorSession();
 if(!session)return {status:401,subject:""};
 if(session.role!=="operator"||!session.permissions?.includes("hr"))return {status:403,subject:""};
 if(!/^emp_[a-f0-9]{32}$/.test(id))return {status:400,subject:""};
 return {status:200,subject:session.subject};
}
const fallback=(error:unknown)=>{
 if(!isDshClientError(error))return fail(502,"HR_UNAVAILABLE");
 return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error),headers:{"Cache-Control":"no-store"}});
};
export async function GET(request:Request,context:Context){
 const id=(await context.params).employeeId;
 const auth=await authorized(id);
 if(auth.status!==200)return fail(auth.status,auth.status===401?"UNAUTHENTICATED":"FORBIDDEN");
 const q=new URL(request.url).searchParams;
 const from=q.get("from")??"",to=q.get("to")??"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return fail(400,"INVALID_INPUT");
 try{
  return NextResponse.json(await listHRAttendance(id,from,to,{operatorActorId:auth.subject}),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return fallback(error)}
}
export async function POST(request:Request,context:Context){
 if(!verifySameOrigin(request))return fail(403,"FORBIDDEN");
 const id=(await context.params).employeeId;
 const auth=await authorized(id);
 if(auth.status!==200)return fail(auth.status,auth.status===401?"UNAUTHENTICATED":"FORBIDDEN");
 const key=request.headers.get("Idempotency-Key")?.trim()??"";
 if(key.length<8||key.length>128)return fail(400,"INVALID_INPUT");
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||Object.keys(body).some(k=>!["date","status","note","checkInAt","checkOutAt","expectedVersion"].includes(k))||
 typeof body.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||
 !["present","late","absent","leave"].includes(String(body.status))||
 typeof body.note!=="string"||Array.from(body.note.trim()).length<8||Array.from(body.note.trim()).length>500||
 !Number.isSafeInteger(body.expectedVersion)||(body.expectedVersion as number)<0||
 (body.checkInAt!==undefined&&typeof body.checkInAt!=="string")||
 (body.checkOutAt!==undefined&&typeof body.checkOutAt!=="string"))return fail(400,"INVALID_INPUT");
 try{
  const result=await recordHRAttendance(id,body as HRAttendanceInput,
   {operatorActorId:auth.subject,correlationId:randomUUID(),idempotencyKey:key});
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return fallback(error)}
}
