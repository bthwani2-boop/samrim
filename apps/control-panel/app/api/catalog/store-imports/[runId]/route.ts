import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { commitOperatorStoreCatalogImport, dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreCatalogImport } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

type RouteContext = Readonly<{ params: Promise<Readonly<{ runId: string }>> }>;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorizedOperator() {
  const identity = await readOperatorSession();
  if (!identity) return { error: errorResponse("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator") return { error: errorResponse("FORBIDDEN", "control operator access is required", 403) } as const;
  const denied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (denied) return { error: denied } as const;
  return { identity } as const;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await authorizedOperator();
  if ("error" in authorization) return authorization.error;
  try {
    const { runId } = await context.params;
    const result = await readOperatorStoreCatalogImport(runId, { operatorActorId: authorization.identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    return errorResponse("INTERNAL_ERROR", "store catalog import readback failed", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const authorization = await authorizedOperator();
  if ("error" in authorization) return authorization.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  try {
    const { runId } = await context.params;
    const result = await commitOperatorStoreCatalogImport(runId, { operatorActorId: authorization.identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    return errorResponse("INTERNAL_ERROR", "store catalog import commit failed", 500);
  }
}
