import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, updateOperatorStoreCatalogOffer } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
async function access(request: Request) {
 if (!verifySameOrigin(request)) return { response: fail("FORBIDDEN","Cross-origin request rejected",403) };
 const identity = await readOperatorSession();
 if (!identity) return { response: fail("UNAUTHENTICATED","Authentication required",401) };
 if (identity.role !== "operator") return { response: fail("FORBIDDEN","Operator access required",403) };
 const denied = operatorWorkspacePermissionDenied(identity,"partners");
 if (denied) return { response: denied };
 return { actorId: identity.subject };
}
function error(cause: unknown) {
 if (isDshClientError(cause)) {const value=dshErrorPayload(cause);return fail(value.code,value.message,dshHttpStatus(cause));}
 return fail("INTERNAL_ERROR","The Store catalog request failed",500);
}
function mutation(request: Request) {
 const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
 return key.length >= 8 ? { idempotencyKey:key, correlationId:request.headers.get("X-Correlation-ID")?.trim() || randomUUID() } : null;
}

export async function PATCH(request: Request, ctx:{params:Promise<{storeId:string;offerId:string}>}) {
 const permit=await access(request);if(permit.response)return permit.response;
 const {storeId,offerId}=await ctx.params;const attempt=mutation(request);
 const version=Number(request.headers.get("X-Expected-Version"));
 if(!storeId||storeId.length>128||!offerId||offerId.length>128||!attempt||!Number.isSafeInteger(version)||version<1)return fail("INVALID_INPUT","Store, offer, version or mutation key invalid",400);
 const input=await request.json().catch(()=>null);
 if(!input||typeof input!=="object"||!Number.isSafeInteger(input.priceMinor)||input.priceMinor<1)return fail("INVALID_INPUT","Invalid Store offer update",400);
 try{const result=await updateOperatorStoreCatalogOffer(storeId,offerId,input,{operatorActorId:permit.actorId!,expectedVersion:version,...attempt});return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}})}
 catch(cause){return error(cause)}
}
