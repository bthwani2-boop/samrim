import { randomUUID } from "node:crypto";
import type { StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readOperatorStoreAvailability, updateOperatorStoreAvailability } from "../../../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../../../src/server/security/csrf";

const error = (code: string, status: number) => NextResponse.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
async function actor() {
  const identity = await readOperatorSession();
  if (!identity || identity.role !== "operator") return null;
  return identity;
}
export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return error("FORBIDDEN", 403);
  const identity = await actor();
  if (!identity) return error("UNAUTHENTICATED", 401);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  const { storeId } = await context.params;
  if (!storeId || storeId.length > 128) return error("INVALID_INPUT", 400);
  try {
    const data = await readOperatorStoreAvailability(storeId, { operatorActorId: identity.subject });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (!isDshClientError(cause)) return error("INTERNAL_ERROR", 500);
    const detail = dshErrorPayload(cause);
    return error(detail.code, dshHttpStatus(cause));
  }
}
export async function PATCH(request: Request, context: { params: Promise<{ storeId: string }> }) {
  if (!verifySameOrigin(request)) return error("FORBIDDEN", 403);
  const identity = await actor();
  if (!identity) return error("UNAUTHENTICATED", 401);
  const denied = operatorWorkspacePermissionDenied(identity, "operations");
  if (denied) return denied;
  const { storeId } = await context.params;
  if (!storeId || storeId.length > 128) return error("INVALID_INPUT", 400);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("INVALID_INPUT", 400);
  const data = payload as Record<string, unknown>;
  const allowed = new Set(["scheduleMode", "weeklySchedule", "paused", "pauseReason", "pauseUntil", "preparationMinutes", "unavailableFulfillmentModes", "expectedVersion"]);
  if (Object.keys(data).some((key) => !allowed.has(key)) || !["WEEKLY", "ALWAYS_OPEN"].includes(String(data.scheduleMode))
    || typeof data.paused !== "boolean" || !Array.isArray(data.weeklySchedule) || data.weeklySchedule.length > 28
    || !Array.isArray(data.unavailableFulfillmentModes)
    || !Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion) < 1) return error("INVALID_INPUT", 400);
  const key = request.headers.get("Idempotency-Key")?.trim() || randomUUID();
  if (key.length < 8 || key.length > 128) return error("INVALID_INPUT", 400);
  try {
    const result = await updateOperatorStoreAvailability(storeId, data as StoreOperationalAvailabilityRequest, {
      operatorActorId: identity.subject, correlationId: request.headers.get("X-Correlation-ID")?.trim() || randomUUID(), idempotencyKey: key,
    });
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (!isDshClientError(cause)) return error("INTERNAL_ERROR", 500);
    const detail = dshErrorPayload(cause);
    return error(detail.code, dshHttpStatus(cause));
  }
}
