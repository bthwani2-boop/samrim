import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, proposePartnersStoreCommercialAgreement, readPartnersStoreCommercialAgreements } from "../../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
async function authorize(storeId: string) {
  const identity = await readOperatorSession();
  if (!identity) return { error: fail("UNAUTHENTICATED", "authentication is required", 401) } as const;
  if (identity.role !== "operator" || !identity.permissions?.includes("partners")) return { error: fail("FORBIDDEN", "Partners permission is required", 403) } as const;
  if (!storeId?.trim() || storeId.length > 128) return { error: fail("INVALID_INPUT", "storeId is invalid", 400) } as const;
  return { actorId: identity.subject } as const;
}
function handled(error: unknown) {
  if (!isDshClientError(error)) return fail("INTERNAL_ERROR", "Store agreement readback failed", 500);
  const payload = dshErrorPayload(error);
  return fail(payload.code, payload.message, dshHttpStatus(error));
}
export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await context.params;
  const access = await authorize(storeId);
  if ("error" in access) return access.error;
  try {
    return NextResponse.json(await readPartnersStoreCommercialAgreements(storeId, { operatorActorId: access.actorId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handled(error); }
}
export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return fail("FORBIDDEN", "cross-site requests are forbidden", 403);
  const { storeId } = await context.params;
  const access = await authorize(storeId);
  if ("error" in access) return access.error;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const correlationId = request.headers.get("X-Correlation-ID")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || correlationId.length < 8 || correlationId.length > 128) return fail("INVALID_INPUT", "Mutation keys are required", 400);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const rates = body?.rates;
  const reason = body?.reason;
  const version = body?.expectedCurrentVersion;
  if (!body || Object.keys(body).some(key => !["rates", "reason", "expectedCurrentVersion"].includes(key)) || !Array.isArray(rates) || rates.length < 1 || rates.length > 3 || rates.some(rate => !rate || typeof rate !== "object" || Object.keys(rate).some(k => !["fulfillmentMode", "commissionRateBps"].includes(k)) || !["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"].includes(rate.fulfillmentMode) || !Number.isInteger(rate.commissionRateBps) || rate.commissionRateBps < 0 || rate.commissionRateBps > 10000) || !Number.isInteger(version) || Number(version) < 0 || typeof reason !== "string" || Array.from(reason.trim()).length < 8 || Array.from(reason.trim()).length > 500) return fail("INVALID_INPUT", "Agreement proposal is invalid", 400);
  try {
    const result = await proposePartnersStoreCommercialAgreement(storeId, rates as {fulfillmentMode: "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";commissionRateBps:number}[], Number(version), reason, { operatorActorId: access.actorId, correlationId, idempotencyKey });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handled(error); }
}