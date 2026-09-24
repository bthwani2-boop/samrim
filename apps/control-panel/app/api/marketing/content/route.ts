import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreateDiscoveryContentRequest } from "@bthwani/dsh";
import { createMarketingContent, createMarketingContentWithMedia, dshErrorPayload, dshHttpStatus, isDshClientError, listMarketingContent } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (permissionDenied) return permissionDenied;
  try {
    return NextResponse.json(await listMarketingContent({ operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery content lookup failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);

  if (request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
    const form = await request.formData();
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const id = text("id");
    const kind = text("kind");
    const titleAr = text("titleAr");
    const targetType = text("targetType");
    const startsAt = text("startsAt");
    const ordinal = Number(text("ordinal"));
    const file = form.get("file");
    if (!id || !["BANNER", "CAROUSEL", "SHORT_FORM"].includes(kind) || !titleAr || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(targetType) || !startsAt || !Number.isSafeInteger(ordinal) || ordinal < 0) return errorResponse("INVALID_INPUT", "content id, kind, title, target type, startsAt and ordinal are required", 400);
    if (targetType !== "INFO" && !text("targetId")) return errorResponse("INVALID_INPUT", "targetId is required for this content target", 400);
    if ((kind === "BANNER" || kind === "CAROUSEL") && (!(file instanceof File) || file.size === 0)) return errorResponse("INVALID_INPUT", "an image file is required for banner and carousel content", 400);
    if (file instanceof File && file.size > 10 * 1024 * 1024) return errorResponse("INVALID_INPUT", "image files must be 10 MiB or smaller", 400);
    if (file instanceof File && !["image/jpeg", "image/png"].includes(file.type.toLowerCase())) return errorResponse("INVALID_INPUT", "only JPEG and PNG images are supported", 400);
    const forward = new FormData();
    for (const name of ["id", "kind", "titleAr", "bodyAr", "targetType", "targetId", "serviceCityId", "startsAt", "endsAt", "ordinal"]) {
      const value = text(name);
      if (value) forward.append(name, value);
    }
    if (file instanceof File) forward.append("file", file, file.name || "marketing-image");
    try {
      const result = await createMarketingContentWithMedia(forward, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
      return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery content creation failed", 500);
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !body.id.trim() || !["BANNER", "CAROUSEL", "SHORT_FORM"].includes(String(body.kind)) || typeof body.titleAr !== "string" || !body.titleAr.trim() || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(String(body.targetType)) || typeof body.startsAt !== "string" || !body.startsAt.trim() || !Number.isSafeInteger(body.ordinal) || Number(body.ordinal) < 0) return errorResponse("INVALID_INPUT", "content id, kind, title, target type, startsAt and ordinal are required", 400);
  const targetType = body.targetType as CreateDiscoveryContentRequest["targetType"];
  const input: CreateDiscoveryContentRequest = {
    id: body.id.trim(),
    kind: body.kind as CreateDiscoveryContentRequest["kind"],
    titleAr: body.titleAr.trim(),
    targetType,
    startsAt: body.startsAt.trim(),
    ordinal: Number(body.ordinal),
    ...(typeof body.bodyAr === "string" && body.bodyAr.trim() ? { bodyAr: body.bodyAr.trim() } : {}),
    ...(typeof body.mediaUri === "string" && body.mediaUri.trim() ? { mediaUri: body.mediaUri.trim() } : {}),
    ...(typeof body.targetId === "string" && body.targetId.trim() ? { targetId: body.targetId.trim() } : {}),
    ...(typeof body.serviceCityId === "string" && body.serviceCityId.trim() ? { serviceCityId: body.serviceCityId.trim() } : {}),
    ...(typeof body.endsAt === "string" && body.endsAt.trim() ? { endsAt: body.endsAt.trim() } : {}),
  };
  try {
    const result = await createMarketingContent(input, { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "discovery content creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
