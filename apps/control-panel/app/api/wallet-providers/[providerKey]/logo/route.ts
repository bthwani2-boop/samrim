import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload,dshHttpStatus,isDshClientError,readMediaProvenanceInput,uploadOperatorWalletProviderLogo } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function fail(code:string,message:string,status:number){return NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request,context:{params:Promise<{providerKey:string}>}){
 if(!verifySameOrigin(request))return fail("FORBIDDEN","cross-site requests are forbidden",403);
 const identity=await readOperatorSession();
 if(!identity)return fail("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator"||!identity.permissions?.includes("platform_policies"))return fail("FORBIDDEN","platform policy permission required",403);
 const idem=request.headers.get("Idempotency-Key")?.trim()??"";
 const version=Number(request.headers.get("X-Expected-Version"));
 if(idem.length<8||idem.length>128||!Number.isSafeInteger(version)||version<1)return fail("INVALID_INPUT","version and idempotency key required",400);
 const form=await request.formData().catch(()=>null);
 const file=form?.get("file");
 const provenance=form?readMediaProvenanceInput(form):null;
 if(!(file instanceof File)||file.size<1||file.size>10*1024*1024||!["image/jpeg","image/png"].includes(file.type)||!provenance)return fail("INVALID_INPUT","valid JPEG/PNG and rights provenance required",400);
 try {
  const {providerKey}=await context.params;
  const response=await uploadOperatorWalletProviderLogo(providerKey,file,provenance,{operatorActorId:identity.subject,correlationId:request.headers.get("X-Correlation-ID")?.trim()||randomUUID(),idempotencyKey:idem,expectedVersion:version});
  return NextResponse.json(response.payload,{status:response.status,headers:{"Cache-Control":"no-store"}});
 }catch(e){
  if(!isDshClientError(e))return fail("INTERNAL_ERROR","wallet logo upload failed",500);
  const payload=dshErrorPayload(e);return fail(payload.code,payload.message,dshHttpStatus(e));
 }
}
