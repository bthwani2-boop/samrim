import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createOperatorCaptainMinimumBalancePolicy, readOperatorCaptainMinimumBalancePolicy, listOperatorCaptainMinimumBalanceHistory, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function err(code: string, message: string, status: number) {
 return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
async function access() {
 const who=await readOperatorSession();
 if (!who) return {error:err("UNAUTHENTICATED","authentication is required",401)} as const;
 if (who.role!=="operator" || !who.permissions?.includes("platform_policies")) return {error:err("FORBIDDEN","platform policy permission required",403)} as const;
 return {who} as const;
}
function failed(error:unknown){
 if(!isDshClientError(error))return err("INTERNAL_ERROR","captain balance policy unavailable",500);
 const data=dshErrorPayload(error);
 return err(data.code,data.message,dshHttpStatus(error));
}
export async function GET(request:Request) {
 const a=await access();if("error" in a)return a.error;
 try{
  const ctx={operatorActorId:a.who.subject};
  const result=new URL(request.url).searchParams.get("history")==="true"
   ?await listOperatorCaptainMinimumBalanceHistory(ctx)
   :await readOperatorCaptainMinimumBalancePolicy(ctx);
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
export async function POST(request:Request){
 if(!verifySameOrigin(request))return err("FORBIDDEN","cross-site requests forbidden",403);
 const a=await access();if("error" in a)return a.error;
 const idem=request.headers.get("Idempotency-Key")?.trim()??"";
 if(idem.length<8 || idem.length>128)return err("INVALID_INPUT","idempotency key required",400);
 const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body || Object.keys(body).some(k=>!["minimumAvailableMinor","expectedVersion","reason"].includes(k)) ||
  !Number.isSafeInteger(body.minimumAvailableMinor) || Number(body.minimumAvailableMinor)<=0 ||
  !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<0 ||
  typeof body.reason!=="string" || body.reason.trim().length<5 || body.reason.trim().length>500)
  return err("INVALID_INPUT","captain balance policy fields invalid",400);
 try{
  const result=await createOperatorCaptainMinimumBalancePolicy({
   minimumAvailableMinor:Number(body.minimumAvailableMinor),expectedVersion:Number(body.expectedVersion),reason:body.reason.trim()
  },{operatorActorId:a.who.subject,correlationId:request.headers.get("X-Correlation-ID")?.trim()||randomUUID(),idempotencyKey:idem});
  return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
