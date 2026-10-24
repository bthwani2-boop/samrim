import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { setOperatorMarketingCampaignState, isDshClientError, dshErrorPayload, dshHttpStatus } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

const fail=(code:string,message:string,status:number)=>NextResponse.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request, {params}:{params:Promise<{campaignId:string}>}) {
 if(!verifySameOrigin(request)) return fail("FORBIDDEN","cross-site requests are forbidden",403);
 const identity=await readOperatorSession();
 if(!identity) return fail("UNAUTHENTICATED","authentication required",401);
 if(identity.role!=="operator") return fail("FORBIDDEN","operator required",403);
 const denied=operatorWorkspacePermissionDenied(identity,"marketing");
 if(denied) return denied;
 const {campaignId}=await params;
 const key=request.headers.get("Idempotency-Key")?.trim() ?? "";
 const rawVersion=request.headers.get("X-Expected-Version")?.trim() ?? "";
 const version=/^[1-9][0-9]*$/.test(rawVersion)?Number(rawVersion):NaN;
 const body:unknown=await request.json().catch(()=>null);
 const state=body && typeof body==="object" && !Array.isArray(body)?(body as {state?:unknown}).state:null;
 if(!campaignId || campaignId.length>128 || key.length<8 || key.length>128 || !Number.isSafeInteger(version) || !["PUBLISHED","PAUSED","ENDED","ARCHIVED"].includes(String(state))) return fail("INVALID_INPUT","campaign state, version and idempotency key are required",400);
 try {
   const result=await setOperatorMarketingCampaignState(campaignId,state as "PUBLISHED"|"PAUSED"|"ENDED"|"ARCHIVED",{operatorActorId:identity.subject,correlationId:request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),idempotencyKey:key,expectedVersion:version});
   return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}});
 }catch(error){if(!isDshClientError(error))return fail("INTERNAL_ERROR","campaign state change failed",500);const reason=dshErrorPayload(error);return fail(reason.code,reason.message,dshHttpStatus(error));}
}
