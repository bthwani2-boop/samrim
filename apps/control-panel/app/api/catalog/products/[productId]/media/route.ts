import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, uploadCatalogProductMedia } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "catalog");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const expectedVersion = Number(request.headers.get("X-Expected-Version")?.trim());
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "Idempotency-Key and X-Expected-Version are required", 400);
  const form = await request.formData().catch(() => null);
  const role = form?.get("role");
  const file = form?.get("file");
  if ((role !== "primary" && role !== "gallery") || !(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024) return errorResponse("INVALID_INPUT", "a valid JPEG or PNG image is required", 400);
  try {
    const { productId } = await context.params;
    const result = await uploadCatalogProductMedia(productId, file, role, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), expectedVersion, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "catalog Product image upload failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
