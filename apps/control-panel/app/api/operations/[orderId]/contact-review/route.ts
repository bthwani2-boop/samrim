import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, requestDshJson } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const noStore = { "Cache-Control": "no-store" };
type Context = Readonly<{ params: Promise<{ orderId: string }> }>;
function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: noStore });
}
async function authorize() {
  const identity = await readOperatorSession();
  if (!identity) return { error: failure("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: failure("FORBIDDEN", "operator access is required", 403) } as const;
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return { error: denied } as const;
  return { actor: identity.subject } as const;
}

export async function GET(_request: Request, context: Context) {
  const access = await authorize();
  if ("error" in access) return access.error;
  const { orderId } = await context.params;
  if (!orderId?.trim() || orderId.length > 128) return failure("INVALID_INPUT", "orderId is invalid", 400);
  try {
    const { payload } = await requestDshJson("GET", `/dsh/operator/operations/${encodeURIComponent(orderId)}/contact-review`,
      undefined, { "X-Acting-Actor-ID": access.actor });
    return NextResponse.json(payload, { headers: noStore });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "customer contact review is unavailable", 500);
    const detail = dshErrorPayload(error);
    return failure(detail.code, detail.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request, context: Context) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-site requests are forbidden", 403);
  const access = await authorize();
  if ("error" in access) return access.error;
  const { orderId } = await context.params;
  const body = await request.json().catch(() => null) as { decision?: unknown; expectedVersion?: unknown } | null;
  const choices = ["CONFIRMED", "NO_ANSWER", "DENIED", "WRONG_NUMBER"];
  const decision = body?.decision;
  const version = body?.expectedVersion;
  const key = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
  if (!orderId?.trim() || orderId.length > 128 || typeof decision !== "string" || !choices.includes(decision)
    || !Number.isSafeInteger(version) || Number(version) < 0 || key.length < 8 || key.length > 128) {
    return failure("INVALID_INPUT", "contact decision, current version and valid key are required", 400);
  }
  try {
    const result = await requestDshJson("POST", `/dsh/operator/operations/${encodeURIComponent(orderId)}/contact-review`,
      { decision, expectedVersion: version }, {
        "X-Acting-Actor-ID": access.actor,
        "Idempotency-Key": key,
        "X-Correlation-ID": request.headers.get("X-Correlation-ID")?.trim() || randomUUID(),
      });
    return NextResponse.json(result.payload, { status: result.status, headers: noStore });
  } catch (error) {
    if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "contact decision outcome unknown; read back before retry", 500);
    const detail = dshErrorPayload(error);
    return failure(detail.code, detail.message, dshHttpStatus(error));
  }
}
