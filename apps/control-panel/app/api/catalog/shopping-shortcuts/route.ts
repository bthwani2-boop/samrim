import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { validateShoppingShortcutPayload } from "./shortcut-input";
import { dshErrorPayload, dshHttpStatus, isDshClientError, listShoppingShortcuts, mutateShoppingShortcut } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function operator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "Catalog permission is required", 403) } as const;
  const denied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (denied) return { error: denied } as const;
  return { identity } as const;
}

export async function GET(request: Request) {
  const auth = await operator();
  if ("error" in auth) return auth.error;
  const verticalId = new URL(request.url).searchParams.get("verticalId")?.trim() ?? "";
  if (!verticalId || verticalId.length > 128) return errorResponse("INVALID_INPUT", "verticalId is required", 400);
  try {
    return NextResponse.json(await listShoppingShortcuts({ operatorActorId: auth.identity.subject }, verticalId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "shopping shortcuts unavailable", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const auth = await operator();
  if ("error" in auth) return auth.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const input = validateShoppingShortcutPayload(await request.json().catch(() => null), false);
  if (!input) return errorResponse("INVALID_INPUT", "shopping shortcut fields and compatible targets are required", 400);
  try {
    const result = await mutateShoppingShortcut(input, { operatorActorId: auth.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "shopping shortcut create failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
