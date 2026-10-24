import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const headers = { "Cache-Control": "no-store" };
const failure = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status, headers });
type Context = Readonly<{ params: Promise<{ orderId: string }> }>;
async function authorize() {
 const identity = await readOperatorSession();
 if (!identity) return { error: failure("UNAUTHENTICATED", "authentication required", 401) } as const;
 if (identity.role !== "operator") return { error: failure("FORBIDDEN", "operator access required", 403) } as const;
 const denied = operatorWorkspacePermissionDenied(identity, "operations");
 if (denied) return { error: denied } as const;
 return { actor: identity.subject } as const;
}
const failDsh = (error: unknown) => {
 if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "result unknown; read current case list", 500);
 const detail = dshErrorPayload(error);
 return failure(detail.code, detail.message, dshHttpStatus(error));
};
export async function GET(request: Request, context: Context) {
 const access = await authorize();
 if ("error" in access) return access.error;
 const { orderId } = await context.params;
 const params = new URL(request.url).searchParams;
 const limit = params.get("limit") ?? "15";
 const cursor = params.get("cursor") ?? "";
 if (!orderId?.trim() || orderId.length > 128 || !/^\d+$/.test(limit) ||
     Number(limit) < 1 || Number(limit) > 30 || (cursor && !/^[1-9]\d{0,18}$/.test(cursor))) {
   return failure("INVALID_INPUT", "invalid case query", 400);
 }
 const query = new URLSearchParams({ limit });
 if (cursor) query.set("cursor", cursor);
 try {
  const result = await requestDshJson("GET", `/dsh/operator/operations/${encodeURIComponent(orderId)}/cases?${query.toString()}`,
    undefined, { "X-Acting-Actor-ID": access.actor });
  return NextResponse.json(result.payload, { headers });
 } catch(error) {return failDsh(error);}
}
export async function POST(request: Request, context: Context) {
 if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-origin request", 403);
 const access = await authorize();
 if ("error" in access) return access.error;
 const { orderId } = await context.params;
 const data = await request.json().catch(() => null) as { reason?: unknown; priority?: unknown; nextAction?: unknown } | null;
 const reasons = ["PARTNER_DELAY","DISPATCH_UNAVAILABLE","DELIVERY_BLOCKED","CUSTOMER_CONTACT","PAYMENT_EXCEPTION","OTHER"];
 const key = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
 if (!orderId?.trim() || orderId.length > 128 || !data || typeof data.reason !== "string" ||
   !reasons.includes(data.reason) || (data.priority !== "NORMAL" && data.priority !== "URGENT") ||
   typeof data.nextAction !== "string" || data.nextAction.trim().length < 12 || data.nextAction.length > 500 ||
   key.length < 8 || key.length > 128) return failure("INVALID_INPUT", "invalid case details", 400);
 try {
   const result=await requestDshJson("POST", `/dsh/operator/operations/${encodeURIComponent(orderId)}/cases`,
    {reason:data.reason,priority:data.priority,nextAction:data.nextAction.trim()},
    {"X-Acting-Actor-ID":access.actor,"Idempotency-Key":key,"X-Correlation-ID":request.headers.get("X-Correlation-ID")?.trim()||randomUUID()});
   return NextResponse.json(result.payload,{status:result.status,headers});
 }catch(error){return failDsh(error);}
}
