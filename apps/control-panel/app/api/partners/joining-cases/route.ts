import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { JoiningCaseState } from "@bthwani/dsh";

import { createJoiningCase, dshErrorPayload, dshHttpStatus, isDshClientError, listJoiningCases } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;
const fulfillmentModes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;
const joiningCaseStates = new Set<JoiningCaseState>(["draft", "admission_requested", "submitted", "needs_correction", "approved"]);

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse("INVALID_INPUT", "Idempotency-Key is required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Object.keys(body).some((key) => !["contactPhoneE164", "businessName", "firstStoreName", "serviceCityId", "firstStoreVerticalId", "firstStoreLatitude", "firstStoreLongitude", "firstStoreFulfillmentModes"].includes(key)) || Object.keys(body).length !== 8) return errorResponse("INVALID_INPUT", "joining case facts, fulfillment modes, and fixed store origin are required", 400);
  if (typeof body.contactPhoneE164 !== "string" || typeof body.businessName !== "string" || typeof body.firstStoreName !== "string" || typeof body.serviceCityId !== "string" || typeof body.firstStoreVerticalId !== "string" || typeof body.firstStoreLatitude !== "number" || typeof body.firstStoreLongitude !== "number" || !Array.isArray(body.firstStoreFulfillmentModes) || body.firstStoreFulfillmentModes.length < 1 || body.firstStoreFulfillmentModes.some((mode) => typeof mode !== "string" || !fulfillmentModes.includes(mode as (typeof fulfillmentModes)[number])) || new Set(body.firstStoreFulfillmentModes).size !== body.firstStoreFulfillmentModes.length) return errorResponse("INVALID_INPUT", "joining case facts must use valid types and fulfillment modes", 400);
  const contactPhoneE164 = body.contactPhoneE164.replace(/\s+/g, "");
  if (!phoneE164Pattern.test(contactPhoneE164)) return errorResponse("INVALID_INPUT", "contactPhoneE164 must use strict E.164 format", 400);
  try {
    const result = await createJoiningCase(
      { contactPhoneE164, businessName: body.businessName.trim(), firstStoreName: body.firstStoreName.trim(), serviceCityId: body.serviceCityId.trim(), firstStoreVerticalId: body.firstStoreVerticalId.trim(), firstStoreLatitude: body.firstStoreLatitude, firstStoreLongitude: body.firstStoreLongitude, firstStoreFulfillmentModes: body.firstStoreFulfillmentModes as (typeof fulfillmentModes)[number][] },
      { operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey },
    );
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case creation failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "control operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const rawSort = params.get("sort") ?? "created_asc";
  const sort = rawSort === "created_asc" || rawSort === "created_desc" ? rawSort : null;
  const state = params.get("state") ?? "";
  const query = params.get("q")?.trim() ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || sort === null || query.length > 128 || (state && !joiningCaseStates.has(state as JoiningCaseState))) return errorResponse("INVALID_INPUT", "joining case search, state, sort, or page limit is invalid", 400);
  try {
    return NextResponse.json(await listJoiningCases(state, query, sort, limit, params.get("cursor") ?? "", { operatorActorId: identity.subject }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("INTERNAL_ERROR", "joining case queue read failed", 500);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
