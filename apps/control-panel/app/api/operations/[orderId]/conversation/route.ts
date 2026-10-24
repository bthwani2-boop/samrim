import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { currentOperatorAccessTokenForDsh, readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const noStore = { "Cache-Control": "no-store" };
function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}
async function authorized() {
  const actor = await readOperatorSession();
  if (!actor || actor.role !== "operator" || operatorWorkspacePermissionDenied(actor, "operations")) return null;
  const token = await currentOperatorAccessTokenForDsh();
  return token ? { actor, token } : null;
}

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const auth = await authorized();
  if (!auth) return failure("FORBIDDEN", "operator operations access required", 403);
  const { orderId } = await context.params;
  if (!orderId || orderId.length > 128) return failure("INVALID_INPUT", "order ID invalid", 400);
  try {
    const before = new URL(request.url).searchParams.get("before")?.trim() ?? "";
    if (before.length > 128) return failure("INVALID_INPUT", "conversation cursor invalid", 400);
    const path = `/dsh/orders/${encodeURIComponent(orderId)}/conversation?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const response = await requestDshJson("GET", path, undefined, {}, auth.token);
    return NextResponse.json(response.payload, { status: response.status, headers: noStore });
  } catch (error) {
    const payload = dshErrorPayload(error);
    return failure(payload.code, payload.message, isDshClientError(error) ? dshHttpStatus(error) : 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-site requests forbidden", 403);
  const auth = await authorized();
  if (!auth) return failure("FORBIDDEN", "operator operations access required", 403);
  const { orderId } = await context.params;
  const body = await request.json().catch(() => null) as { body?: unknown; recipientRoles?: unknown; mediaKind?: unknown; mediaContentType?: unknown; mediaBase64?: unknown } | null;
  const message = typeof body?.body === "string" ? body.body.trim() : "";
  const recipients = body?.recipientRoles;
  const kind=body?.mediaKind;
  const contentType=body?.mediaContentType;
  const mediaBase64=body?.mediaBase64;
  const hasMedia=kind!==undefined||contentType!==undefined||mediaBase64!==undefined;
  const mimeAllowed=kind==="image"&&["image/jpeg","image/png","image/webp"].includes(String(contentType))
    ||kind==="audio"&&["audio/mp4","audio/m4a","audio/3gpp","audio/webm","audio/aac"].includes(String(contentType))
    ||kind==="video"&&["video/mp4","video/webm"].includes(String(contentType));
  if(hasMedia&&(!mimeAllowed||typeof mediaBase64!=="string"||mediaBase64.length<16
    ||mediaBase64.length>8*1024*1024+128||!/^[a-zA-Z0-9+/]*={0,2}$/.test(mediaBase64))){
    return failure("INVALID_INPUT","private media kind, encoding or size invalid",400);
  }
  const allowed = ["client", "partner", "captain", "operator"];
  if (!orderId || orderId.length > 128 || Array.from(message).length < 1 || Array.from(message).length > 2000 ||
      !Array.isArray(recipients) || recipients.length < 1 || recipients.length > 4 ||
      !recipients.every(role => typeof role === "string" && allowed.includes(role)) ||
      new Set(recipients).size !== recipients.length) {
    return failure("INVALID_INPUT", "message and valid recipients required", 400);
  }
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 128) return failure("INVALID_INPUT", "idempotency key required", 400);
  try {
    const response = await requestDshJson("POST", `/dsh/orders/${encodeURIComponent(orderId)}/conversation/messages`,
      { body: message, recipientRoles: recipients, ...(hasMedia ? {mediaKind:kind,mediaContentType:contentType,mediaBase64} : {}) },
      { "Idempotency-Key": key, "X-Correlation-ID": request.headers.get("X-Correlation-ID")?.trim() || randomUUID() }, auth.token);
    return NextResponse.json(response.payload, { status: response.status, headers: noStore });
  } catch (error) {
    const payload = dshErrorPayload(error);
    return failure(payload.code, payload.message, isDshClientError(error) ? dshHttpStatus(error) : 500);
  }
}
