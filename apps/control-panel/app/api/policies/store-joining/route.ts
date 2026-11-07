import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const noStore={"Cache-Control":"no-store"};
function fail(code:string,status:number){
  return NextResponse.json({error:{code,message:"تعذرت قراءة أو حفظ سياسة الانضمام. تحقق من الصلاحيات والحالة."}},{status,headers:noStore});
}
async function authorized(){
 const actor=await readOperatorSession();
 if(!actor)return {error:fail("UNAUTHENTICATED",401)} as const;
 if(actor.role!=="operator")return {error:fail("FORBIDDEN",403)} as const;
 const denied=operatorWorkspacePermissionDenied(actor,"platform_policies");
 if(denied)return {error:denied} as const;
 return {actor:actor.subject} as const;
}
export async function GET(){
 const identity=await authorized();
 if("error" in identity)return identity.error;
 try{
  const result=await requestDshJson("GET","/dsh/operator/store-joining-policies",undefined,{"X-Acting-Actor-ID":identity.actor});
  return NextResponse.json(result.payload,{headers:noStore});
 }catch(e){
  if(!isDshClientError(e))return fail("OUTCOME_UNKNOWN",503);
  return NextResponse.json({error:dshErrorPayload(e)},{status:dshHttpStatus(e),headers:noStore});
 }
}
export async function PUT(request:Request){
 if(!verifySameOrigin(request))return fail("FORBIDDEN",403);
 const identity=await authorized();
 if("error" in identity)return identity.error;
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||Object.keys(body).some(key=>!["relationModel","enrollmentEnabled","expectedVersion","reason"].includes(key))
 ||!["BTHWANI_PARTNER","INDEPENDENT_STORE"].includes(String(body.relationModel))
 ||typeof body.enrollmentEnabled!=="boolean"||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<1
 ||typeof body.reason!=="string"||body.reason.trim().length<5||body.reason.trim().length>500)
    return fail("INVALID_INPUT",400);
 try{
  const result=await requestDshJson("PUT",`/dsh/operator/store-joining-policies/${body.relationModel}`,
   {enrollmentEnabled:body.enrollmentEnabled,expectedVersion:body.expectedVersion,reason:body.reason.trim()},{
     "X-Acting-Actor-ID":identity.actor,
     "Idempotency-Key":request.headers.get("Idempotency-Key")?.trim()||randomUUID(),
     "X-Correlation-ID":request.headers.get("X-Correlation-ID")?.trim()||randomUUID()
   });
  return NextResponse.json(result.payload,{status:result.status,headers:noStore});
 }catch(e){
  if(!isDshClientError(e))return fail("OUTCOME_UNKNOWN",503);
  return NextResponse.json({error:dshErrorPayload(e)},{status:dshHttpStatus(e),headers:noStore});
 }
}
