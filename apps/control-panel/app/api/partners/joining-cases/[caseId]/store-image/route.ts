import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { dshErrorPayload, dshHttpStatus, isDshClientError, readMediaProvenanceInput, uploadOperatorJoiningCaseStoreImage } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const denied = operatorWorkspacePermissionDenied(identity, "partners");
  if (denied) return denied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const expectedVersion = Number(request.headers.get("X-Expected-Version"));
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !Number.isInteger(expectedVersion) || expectedVersion < 1) return errorResponse("INVALID_INPUT", "Idempotency-Key and expected version are required", 400);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const provenance = form ? readMediaProvenanceInput(form) : null;
  if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type) || !provenance) return errorResponse("INVALID_INPUT", "اختر شعار المتجر JPG أو PNG وأكّد حق استخدامه.", 400);
  try {
    const { caseId } = await context.params;
    const result = await uploadOperatorJoiningCaseStoreImage(caseId, file, provenance, {
      operatorActorId: identity.subject,
      correlationId: request.headers.get("X-Correlation-ID")?.trim() || `cp_joining_store_image_${randomUUID()}`,
      expectedVersion,
      idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "تعذر حفظ شعار المتجر.", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
