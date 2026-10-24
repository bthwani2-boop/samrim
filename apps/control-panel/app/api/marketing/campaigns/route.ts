import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createOperatorMarketingCampaign, listOperatorMarketingCampaigns, isDshClientError, dshErrorPayload, dshHttpStatus } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
async function authorize() {
 const identity = await readOperatorSession();
 if (!identity) return { error: fail("UNAUTHENTICATED", "authentication is required", 401) };
 if (identity.role !== "operator") return { error: fail("FORBIDDEN", "operator access required", 403) };
 const denied = operatorWorkspacePermissionDenied(identity, "marketing");
 return denied ? { error: denied } : { actor: identity.subject };
}
export async function GET(request: Request) {
 const access = await authorize();
 if ("error" in access) return access.error;
 const q = new URL(request.url).searchParams;
 const state = q.get("state") ?? "", cursor = q.get("cursor") ?? "";
 if (!["","DRAFT","PUBLISHED","PAUSED","ENDED","ARCHIVED"].includes(state) || cursor.length > 128) return fail("INVALID_INPUT", "invalid campaign filter", 400);
 try { return NextResponse.json(await listOperatorMarketingCampaigns(state,cursor,{operatorActorId:access.actor!}),{headers:{"Cache-Control":"no-store"}}); }
 catch(error) { if(!isDshClientError(error)) return fail("INTERNAL_ERROR","campaign read failed",500); const reason=dshErrorPayload(error);return fail(reason.code,reason.message,dshHttpStatus(error)); }
}
export async function POST(request: Request) {
 if (!verifySameOrigin(request)) return fail("FORBIDDEN","cross-site mutation denied",403);
 const access=await authorize();
 if ("error" in access) return access.error;
 const key=request.headers.get("Idempotency-Key")?.trim() ?? "";
 if(key.length<8 || key.length>128) return fail("INVALID_INPUT","Idempotency-Key required",400);
 const unknown: unknown=await request.json().catch(()=>null);
 if(!unknown || typeof unknown!=="object" || Array.isArray(unknown)) return fail("INVALID_INPUT","invalid campaign",400);
 const body=unknown as Record<string,unknown>;
 const nameAr=typeof body.nameAr==="string" ? body.nameAr.trim() : "";
 const objective=body.objective;
 const budget=body.budgetLimitMinor;
 if(!nameAr || nameAr.length>160 || !["ACQUISITION","REACTIVATION","CONVERSION","RETENTION"].includes(String(objective)) || !Number.isSafeInteger(budget) || Number(budget)<=0 || Object.keys(body).some(key=>!["nameAr","objective","budgetLimitMinor"].includes(key))) return fail("INVALID_INPUT","name, goal and budget required",400);
 try {
  const result=await createOperatorMarketingCampaign({nameAr,objective:objective as "ACQUISITION"|"REACTIVATION"|"CONVERSION"|"RETENTION",budgetLimitMinor:Number(budget)},{operatorActorId:access.actor!,correlationId:request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),idempotencyKey:key});
  return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}});
 } catch(error) {if(!isDshClientError(error)) return fail("INTERNAL_ERROR","campaign create failed",500);const reason=dshErrorPayload(error);return fail(reason.code,reason.message,dshHttpStatus(error));}
}
