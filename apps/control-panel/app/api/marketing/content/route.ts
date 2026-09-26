import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreateDiscoveryContentRequest } from "@bthwani/dsh";
import { createMarketingContentWithMedia, dshErrorPayload, dshHttpStatus, isDshClientError, listMarketingContent } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const states = ["DRAFT", "PUBLISHED", "PAUSED"] as const;
const kinds = ["BANNER", "CAROUSEL", "SHORT_FORM"] as const;
const sorts = ["priority", "created_desc"] as const;

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "marketing");
  if (permissionDenied) return permissionDenied;
  const query = new URL(request.url).searchParams;
  const search = query.get("search")?.trim() ?? "";
  const state = query.get("state") ?? "";
  const kind = query.get("kind") ?? "";
  const sort = query.get("sort") ?? "priority";
  const cursor = query.get("cursor") ?? "";
  const rawLimit = query.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (search.length > 128 || (state && !states.includes(state as typeof states[number])) || (kind && !kinds.includes(kind as typeof kinds[number])) || !sorts.includes(sort as typeof sorts[number]) || cursor.length > 2048 || !Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse("INVALID_INPUT", "invalid discovery content registry filters", 400);
  try {
    const result = await listMarketingContent({ search, state, kind, sort: sort as typeof sorts[number], cursor, limit }, { operatorActorId: identity.subject });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
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

  return errorResponse("INVALID_INPUT", "discovery content must include its image file through the canonical upload", 400);
}
