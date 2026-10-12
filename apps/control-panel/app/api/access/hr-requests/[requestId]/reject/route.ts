import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { decideHRAccessRequest, dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

export async function POST(request: Request, context: {params: Promise<{requestId: string}>}) {
 if(!verifySameOrigin(request))return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const identity=await readOperatorSession();
 if(!identity)return NextResponse.json({error:{code:"UNAUTHENTICATED"}},{status:401});
 if(identity.role!=="operator"||!identity.canManageOperatorPermissions)return NextResponse.json({error:{code:"FORBIDDEN"}},{status:403});
 const id=(await context.params).requestId;
 if(!/^hreq_[a-f0-9]{32}$/.test(id))return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 const body=await request.json().catch(()=>null);
 if(!body||typeof body.expectedVersion!=="number"||!Number.isInteger(body.expectedVersion)||body.expectedVersion<1||
   typeof body.reason!=="string"||body.reason.trim().length<8||body.reason.trim().length>500||
   Object.keys(body).some((key)=>!["expectedVersion","reason"].includes(key)))
   return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 const key=request.headers.get("Idempotency-Key")?.trim()??"";
 if(key.length<8||key.length>128)return NextResponse.json({error:{code:"INVALID_INPUT"}},{status:400});
 try{
  const result=await decideHRAccessRequest(id,"reject",{expectedVersion:body.expectedVersion,reason:body.reason.trim()},{
   operatorActorId:identity.subject,correlationId:randomUUID(),idempotencyKey:key,
  });
  return NextResponse.json({request:result},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(isDshClientError(error))return NextResponse.json({error:dshErrorPayload(error)},{status:dshHttpStatus(error)});
  return NextResponse.json({error:{code:"UNAVAILABLE"}},{status:502});
 }
}
