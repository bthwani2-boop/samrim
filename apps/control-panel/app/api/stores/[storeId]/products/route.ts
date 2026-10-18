import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listOperatorStoreCatalogProducts, createOperatorStoreCatalogProduct } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

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

export async function GET(request: Request, ctx: {params:Promise<{storeId:string}>}) {
 const permit=await access(request);if(permit.response)return permit.response;
 const {storeId}=await ctx.params;const q=new URL(request.url).searchParams;
 if(!storeId||storeId.length>128||(q.get("q")??"").length>160||(q.get("cursor")??"").length>2048)return fail("INVALID_INPUT","Invalid product search",400);
 try{return NextResponse.json(await listOperatorStoreCatalogProducts(storeId,q.get("q")??"",q.get("cursor")??"",{operatorActorId:permit.actorId!}),{headers:{"Cache-Control":"no-store"}})}
 catch(cause){return error(cause)}
}
export async function POST(request: Request, ctx: {params:Promise<{storeId:string}>}) {
 const permit=await access(request);if(permit.response)return permit.response;
 const {storeId}=await ctx.params;const attempt=mutation(request);
 if(!storeId||storeId.length>128||!attempt)return fail("INVALID_INPUT","Store or idempotency key invalid",400);
 const input=await request.json().catch(()=>null);
 if(!input||typeof input!=="object"||input.scope!=="STORE_SCOPED"||typeof input.canonicalName!=="string"||!input.canonicalName.trim())return fail("INVALID_INPUT","Valid Store product is required",400);
 try{const result=await createOperatorStoreCatalogProduct(storeId,input,{operatorActorId:permit.actorId!,...attempt});return NextResponse.json(result.payload,{status:result.status,headers:{"Cache-Control":"no-store"}})}
 catch(cause){return error(cause)}
}
