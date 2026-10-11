import { randomUUID } from "node:crypto";
import { normalizeYemenPhoneE164 } from "@bthwani/design-system";
import type { CreateJoiningCaseRequest, JoiningCaseState } from "@bthwani/dsh";
import { NextResponse } from "next/server";

import { createJoiningCase, dshErrorPayload, dshHttpStatus, isDshClientError, listJoiningCases } from "../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;
const fulfillmentModes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] as const;
const proofTypes = ["COMMERCIAL_REGISTRATION", "IDENTITY_DOCUMENT", "PASSPORT"] as const;
const joiningCaseStates = new Set<JoiningCaseState>(["draft", "admission_requested", "submitted", "needs_correction", "approved"]);
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
  const allowedKeys = ["contactPhoneE164", "ownerFullName", "businessName", "firstStoreName", "walletProviderKey", "firstStoreAddress", "serviceCityId", "firstStoreVerticalId", "firstStoreCommercialTypeId", "firstStoreLatitude", "firstStoreLongitude", "firstStoreWorkingHours", "firstStoreProofType", "firstStoreProofNumber", "firstStoreNotes", "firstStoreFulfillmentModes"];
  if (!body || Object.keys(body).some((key) => !allowedKeys.includes(key)) || Object.keys(body).length < 15 || Object.keys(body).length > 16) return errorResponse("INVALID_INPUT", "owner, wallet provider, store, schedule, proof, location, and fulfillment details are required", 400);
  const hours = body.firstStoreWorkingHours && typeof body.firstStoreWorkingHours === "object" ? (body.firstStoreWorkingHours as { intervals?: unknown }).intervals : null;
  const validHours = Array.isArray(hours) && hours.length >= 1 && hours.length <= 28 && hours.every((item) => {
    if (!item || typeof item !== "object") return false;
    const interval = item as Record<string, unknown>;
    return Number.isInteger(interval.dayOfWeek) && Number(interval.dayOfWeek) >= 1 && Number(interval.dayOfWeek) <= 7 && typeof interval.opensAt === "string" && localTimePattern.test(interval.opensAt) && typeof interval.closesAt === "string" && localTimePattern.test(interval.closesAt) && typeof interval.closesNextDay === "boolean" && (interval.closesNextDay || interval.opensAt !== interval.closesAt);
  }) && new Set(hours.map((item) => `${(item as { dayOfWeek: number }).dayOfWeek}:${(item as { opensAt: string }).opensAt}`)).size === hours.length;
  if (typeof body.contactPhoneE164 !== "string" || typeof body.ownerFullName !== "string" || body.ownerFullName.trim().length < 2 || body.ownerFullName.trim().length > 160 || typeof body.walletProviderKey !== "string" || Array.from(body.walletProviderKey.trim()).length < 1 || Array.from(body.walletProviderKey.trim()).length > 64 || /\p{Cc}/u.test(body.walletProviderKey) || typeof body.businessName !== "string" || typeof body.firstStoreName !== "string" || typeof body.firstStoreAddress !== "string" || body.firstStoreAddress.trim().length < 4 || body.firstStoreAddress.trim().length > 500 || typeof body.serviceCityId !== "string" || typeof body.firstStoreVerticalId !== "string" || typeof body.firstStoreCommercialTypeId !== "string" || !body.firstStoreCommercialTypeId.trim() || typeof body.firstStoreLatitude !== "number" || typeof body.firstStoreLongitude !== "number" || !validHours || typeof body.firstStoreProofType !== "string" || !proofTypes.includes(body.firstStoreProofType as (typeof proofTypes)[number]) || typeof body.firstStoreProofNumber !== "string" || Array.from(body.firstStoreProofNumber.trim()).length < 1 || Array.from(body.firstStoreProofNumber.trim()).length > 128 || (body.firstStoreNotes !== undefined && (typeof body.firstStoreNotes !== "string" || body.firstStoreNotes.length > 1000)) || !Array.isArray(body.firstStoreFulfillmentModes) || body.firstStoreFulfillmentModes.length < 1 || body.firstStoreFulfillmentModes.some((mode) => typeof mode !== "string" || !fulfillmentModes.includes(mode as (typeof fulfillmentModes)[number])) || new Set(body.firstStoreFulfillmentModes).size !== body.firstStoreFulfillmentModes.length) return errorResponse("INVALID_INPUT", "joining case facts must use valid types and fulfillment modes", 400);
  const contactPhoneE164 = normalizeYemenPhoneE164(body.contactPhoneE164);
  if (!phoneE164Pattern.test(contactPhoneE164)) return errorResponse("INVALID_INPUT", "contactPhoneE164 must be a valid Yemeni local or international phone", 400);
  try {
    const result = await createJoiningCase(
      { contactPhoneE164, ownerFullName: body.ownerFullName.trim(), walletProviderKey: body.walletProviderKey.trim(), businessName: body.businessName.trim(), firstStoreName: body.firstStoreName.trim(), firstStoreAddress: body.firstStoreAddress.trim(), serviceCityId: body.serviceCityId.trim(), firstStoreVerticalId: body.firstStoreVerticalId.trim(), firstStoreCommercialTypeId: body.firstStoreCommercialTypeId.trim(), firstStoreLatitude: body.firstStoreLatitude, firstStoreLongitude: body.firstStoreLongitude, firstStoreWorkingHours: { intervals: hours as CreateJoiningCaseRequest["firstStoreWorkingHours"]["intervals"] }, firstStoreProofType: body.firstStoreProofType as CreateJoiningCaseRequest["firstStoreProofType"], firstStoreProofNumber: body.firstStoreProofNumber.trim(), ...(typeof body.firstStoreNotes === "string" && body.firstStoreNotes.trim() ? { firstStoreNotes: body.firstStoreNotes.trim() } : {}), firstStoreFulfillmentModes: body.firstStoreFulfillmentModes as (typeof fulfillmentModes)[number][] },
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
