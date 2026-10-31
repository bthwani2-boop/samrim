import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStoreOffers, createOperatorStoreCatalogOffer } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return fail("FORBIDDEN", "Cross-site requests are forbidden.", 403);
  const identity = await readOperatorSession();
  if (!identity) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  if (identity.role !== "operator") return fail("FORBIDDEN", "Operator access required.", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const { storeId } = await context.params;
  const query = new URL(request.url).searchParams;
  const cursor = query.get("cursor") ?? "";
  const limitText = query.get("limit") ?? "8";
  const limit = Number(limitText);
  if (!storeId || storeId.length > 128 || cursor.length > 2048 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    return fail("INVALID_INPUT", "Invalid store offer query.", 400);
  try {
    const data = await listOperatorStoreOffers(storeId, cursor, { operatorActorId: identity.subject }, limit);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return fail("INTERNAL_ERROR", "Store offers could not be read.", 500);
    const payload = dshErrorPayload(error);
    return fail(payload.code, payload.message, dshHttpStatus(error));
  }
}


async function operatorCatalogAccess(request: Request) {
 if(!verifySameOrigin(request))return {response:fail("FORBIDDEN","Cross-origin request rejected",403)};
 const identity=await readOperatorSession();if(!identity)return {response:fail("UNAUTHENTICATED","Authentication required",401)};
 if(identity.role!=="operator")return {response:fail("FORBIDDEN","Operator access required",403)};
 const denied=operatorWorkspacePermissionDenied(identity,"partners");if(denied)return {response:denied};
 return {actorId:identity.subject};
}
function operatorCatalogMutation(request:Request){const idempotencyKey=request.headers.get("Idempotency-Key")?.trim()??"";return idempotencyKey.length>=8?{idempotencyKey,correlationId:request.headers.get("X-Correlation-ID")?.trim()||randomUUID()}:null;}
function operatorCatalogError(cause:unknown){if(isDshClientError(cause)){const value=dshErrorPayload(cause);return fail(value.code,value.message,dshHttpStatus(cause))}return fail("INTERNAL_ERROR","Store catalog mutation failed",500)}
export async function POST(request: Request, ctx: {params:Promise<{storeId:string}>}) {
 const permit=await operatorCatalogAccess(request);if(permit.response)return permit.response;
 const {storeId}=await ctx.params;const attempt=operatorCatalogMutation(request);
 if(!storeId||storeId.length>128||!attempt)return fail("INVALID_INPUT","Store or idempotency key invalid",400);
 const input=await request.json().catch(()=>null);
 if(!input||typeof input!=="object"||typeof input.variantId!=="string"||!Number.isSafeInteger(input.priceMinor)||input.priceMinor<1)return fail("INVALID_INPUT","Invalid Store offer",400);
 try{const result=await createOperatorStoreCatalogOffer(storeId,input,{operatorActorId:permit.actorId!,...attempt});return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}})}
 catch(cause){return operatorCatalogError(cause)}
}
