import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createOperatorDistanceFeePolicy, readOperatorDistanceFeePolicy, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function fail(code:string,message:string,status:number){return NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}})}
async function access(){
 const session=await readOperatorSession();
 if(!session)return {error:fail("UNAUTHENTICATED","authentication required",401)} as const;
 if(session.role!=="operator"||!session.permissions?.includes("platform_policies"))return {error:fail("FORBIDDEN","platform policy permission required",403)} as const;
 return {session} as const;
}
function relay(e:unknown){
 if(!isDshClientError(e))return fail("POLICY_UNAVAILABLE","distance-band policy unavailable",502);
 const payload=dshErrorPayload(e);return fail(payload.code,payload.message,dshHttpStatus(e));
}
export async function GET(request:Request){
 const a=await access();if("error" in a)return a.error;
 const city=new URL(request.url).searchParams.get("serviceCityId")??"";
 if(city.length>128)return fail("INVALID_INPUT","invalid city",400);
 try{return NextResponse.json(await readOperatorDistanceFeePolicy(city,{operatorActorId:a.session.subject}),{headers:{"Cache-Control":"no-store"}})}
 catch(e){return relay(e)}
}
export async function POST(request:Request){
 if(!verifySameOrigin(request))return fail("FORBIDDEN","cross-site request",403);
 const a=await access();if("error" in a)return a.error;
 const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";
 if(idempotencyKey.length<8||idempotencyKey.length>128)return fail("INVALID_INPUT","idempotency key required",400);
 const value=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!value||Object.keys(value).some(k=>!["serviceCityId","distanceBands","expectedVersion","reason"].includes(k))||
  typeof value.serviceCityId!=="string"||value.serviceCityId.length>128||
  !Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<0||
  typeof value.reason!=="string"||value.reason.trim().length<5||value.reason.trim().length>500||
  !Array.isArray(value.distanceBands)||value.distanceBands.length<1||value.distanceBands.length>30)
  return fail("INVALID_INPUT","invalid distance policy",400);
 let last=0;
 for(let index=0;index<value.distanceBands.length;index++){
  const band=value.distanceBands[index] as Record<string,unknown>|null;
  if(!band||Object.keys(band).some(k=>!["upToMeters","ratePerKmMinor"].includes(k))||
   !Number.isSafeInteger(band.ratePerKmMinor)||Number(band.ratePerKmMinor)<=0||Number(band.ratePerKmMinor)>100000000)return fail("INVALID_INPUT","invalid per-km rate",400);
  if(index===value.distanceBands.length-1){if(band.upToMeters!==null)return fail("INVALID_INPUT","final band must be open-ended",400)}
  else if(!Number.isSafeInteger(band.upToMeters)||Number(band.upToMeters)<=last||Number(band.upToMeters)>500000)return fail("INVALID_INPUT","distance limits must be ascending",400);
  if(band.upToMeters!==null)last=Number(band.upToMeters);
 }
 try{
  const result=await createOperatorDistanceFeePolicy({
   serviceCityId:value.serviceCityId.trim(),distanceBands:value.distanceBands,expectedVersion:Number(value.expectedVersion),reason:value.reason.trim(),
  },{operatorActorId:a.session.subject,correlationId:request.headers.get("X-Correlation-ID")?.trim()||randomUUID(),idempotencyKey});
  return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}});
 }catch(e){return relay(e)}
}
