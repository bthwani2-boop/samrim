import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, previewOperatorStoreCatalogImport } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (denied) return denied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const form = await request.formData().catch(() => null);
  if (!form || [...form.keys()].length !== 2 || !form.has("storeId") || !form.has("file")) return errorResponse("INVALID_INPUT", "provide one storeId and one CSV or XLSX file", 400);
  const storeId = form.get("storeId");
  const file = form.get("file");
  if (typeof storeId !== "string" || !storeId.trim() || !(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name)) return errorResponse("INVALID_INPUT", "provide a valid Store ID and a CSV or XLSX file no larger than 20 MiB", 400);
  try {
    const result = await previewOperatorStoreCatalogImport(storeId, file, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    return errorResponse("INTERNAL_ERROR", "store catalog import preview failed", 500);
  }
}
