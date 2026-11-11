import type { PartnerFirstStoreCreateRequest } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { createOperatorMerchantStore, listOperatorPartnerStores } from "../../../../../../src/server/dsh/dsh-bff";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../../../src/server/dsh/dsh-transport";
import { identityErrorPayload, identityHttpStatus, readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const cursor = params.get("cursor") ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 128) return errorResponse("INVALID_INPUT", "valid store page limit and cursor are required", 400);
  const { actorId } = await context.params;
  try {
    const page = await listOperatorPartnerStores(actorId, limit, cursor, { operatorActorId: identity.subject });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return errorResponse(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return errorResponse(payload.code, payload.message, identityHttpStatus(error));
  }
}


function validStoreCreation(value: unknown): value is PartnerFirstStoreCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const fields = ["name", "relationModel", "serviceCityId", "primaryVerticalId",
    "commercialStoreTypeId", "addressText", "latitude", "longitude", "fulfillmentModes"];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some((key) => !fields.includes(key))) return false;
  const name = input.name;
  const address = input.addressText;
  if (typeof name !== "string" || Array.from(name.trim()).length < 2 || Array.from(name.trim()).length > 160 ||
    typeof address !== "string" || Array.from(address.trim()).length < 4 || Array.from(address.trim()).length > 500) return false;
  if (input.relationModel !== "BTHWANI_PARTNER" && input.relationModel !== "INDEPENDENT_STORE") return false;
  if (["serviceCityId", "primaryVerticalId", "commercialStoreTypeId"].some((key) =>
    typeof input[key] !== "string" || !(input[key] as string).trim() || (input[key] as string).length > 128)) return false;
  if (typeof input.latitude !== "number" || !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 ||
    typeof input.longitude !== "number" || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) return false;
  const modes = input.fulfillmentModes;
  if (!Array.isArray(modes) || modes.length < 1 || modes.length > 3 ||
    modes.some(mode => !["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"].includes(mode)) ||
    new Set(modes).size !== modes.length ||
    (input.relationModel === "INDEPENDENT_STORE" && modes.includes("BTHWANI_CAPTAIN"))) return false;
  return true;
}

export async function POST(request: Request, context: { params: Promise<{ actorId: string }> }) {
  if (!verifySameOrigin(request)) return errorResponse("FORBIDDEN", "cross-site Store creation is forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return errorResponse("UNAUTHENTICATED", "operator session is required", 401);
  if (identity.role !== "operator") return errorResponse("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const { actorId } = await context.params;
  if (!actorId.trim() || actorId.length > 128) return errorResponse("INVALID_INPUT", "verified Merchant actor is required", 400);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const correlationId = request.headers.get("X-Correlation-ID")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || correlationId.length < 8 || correlationId.length > 128) {
    return errorResponse("INVALID_INPUT", "bounded mutation identifiers are required", 400);
  }
  const body = await request.json().catch(() => null) as unknown;
  if (!validStoreCreation(body)) return errorResponse("INVALID_INPUT", "Store creation fields are invalid", 400);
  try {
    const result = await createOperatorMerchantStore(actorId, body, {
      operatorActorId: identity.subject, correlationId, idempotencyKey,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isDshClientError(error)) return errorResponse("DEPENDENCY_UNAVAILABLE", "Store creation could not be verified at DSH", 502);
    const payload = dshErrorPayload(error);
    return errorResponse(payload.code, payload.message, dshHttpStatus(error));
  }
}
