import type { StoreRelationCommercialModelUpdate } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError } from "../../../../src/server/dsh/dsh-transport";
import { readOperatorStoreRelationCommercialModelDefaults, updateOperatorStoreRelationCommercialModelDefault } from "../../../../src/server/dsh/store-relation-commercial-model";
import { readOperatorSession } from "../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../src/server/security/csrf";

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
async function authorize() {
  const identity = await readOperatorSession();
  if (!identity) return { error: failure("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator" || !identity.permissions?.includes("platform_policies") ||
    !identity.permissions.includes("finance") || !identity.permissions.includes("partners")) {
    return { error: failure("FORBIDDEN", "Platform policies, Partners and Finance permissions are required", 403) } as const;
  }
  return { actorId: identity.subject } as const;
}
function handled(error: unknown) {
  if (!isDshClientError(error)) return failure("INTERNAL_ERROR", "Commercial model policy owner is unavailable", 502);
  const detail = dshErrorPayload(error);
  return failure(detail.code, detail.message, dshHttpStatus(error));
}

export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  try {
    const result = await readOperatorStoreRelationCommercialModelDefaults({ operatorActorId: auth.actorId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handled(error); }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return failure("FORBIDDEN", "cross-site requests are forbidden", 403);
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const idem = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const correlation = request.headers.get("X-Correlation-ID")?.trim() ?? "";
  if (idem.length < 8 || idem.length > 128 || correlation.length < 8 || correlation.length > 128) {
    return failure("INVALID_INPUT", "Idempotency-Key and X-Correlation-ID are required", 400);
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return failure("INVALID_INPUT", "model policy body is required", 400);
  }
  const raw = body as Record<string, unknown>;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  const expectedVersion = raw.expectedVersion;
  if (Object.keys(raw).some(key => !["relationModel", "commercialModel", "expectedVersion", "reason"].includes(key)) ||
    (raw.relationModel !== "BTHWANI_PARTNER" && raw.relationModel !== "INDEPENDENT_STORE") ||
    (raw.commercialModel !== "COMMISSION" && raw.commercialModel !== "SUBSCRIPTION") ||
    !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0 || Number(expectedVersion) > 999999 ||
    Array.from(reason).length < 8 || Array.from(reason).length > 500) {
    return failure("INVALID_INPUT", "Store relation model default is invalid", 400);
  }
  const input: StoreRelationCommercialModelUpdate = {
    relationModel: raw.relationModel,
    commercialModel: raw.commercialModel,
    expectedVersion: Number(expectedVersion),
    reason,
  };
  try {
    const response = await updateOperatorStoreRelationCommercialModelDefault(input, {
      operatorActorId: auth.actorId,
      idempotencyKey: idem,
      correlationId: correlation,
    });
    return NextResponse.json(response.payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handled(error); }
}
