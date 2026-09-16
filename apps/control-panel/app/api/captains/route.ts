import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitCaptain, dshErrorPayload, dshHttpStatus, dispatchCaptainOffer, recoverCaptainDelivery, reassignCaptainOffer } from "../../../src/server/dsh/dsh-bff";
import { readOperatorSession } from "../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../src/server/security/csrf";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

type DshCaptainResponse = Readonly<{
  idempotentReplay?: boolean;
  admission?: Readonly<{ id: string; actorId?: string | null; state: string; availabilityState: string; version: number }>;
  offer?: Readonly<{ id: string; orderId: string; captainActorId: string; state: string; expiresAt: string; version: number }>;
  assignment?: Readonly<{ id: string; orderId: string; state: string; handoff?: Readonly<{ state: string }>; version: number }> | null;
}>;

function boundedResult(action: string, payload: DshCaptainResponse) {
  const result: Record<string, unknown> = { operation: action, idempotentReplay: payload?.idempotentReplay === true };
  if (payload?.admission) result.admission = { id: payload.admission.id, actorId: payload.admission.actorId, state: payload.admission.state, availabilityState: payload.admission.availabilityState, version: payload.admission.version };
  if (payload?.offer) result.offer = { id: payload.offer.id, orderId: payload.offer.orderId, captainActorId: payload.offer.captainActorId, state: payload.offer.state, expiresAt: payload.offer.expiresAt, version: payload.offer.version };
  if (payload?.assignment) result.assignment = { id: payload.assignment.id, orderId: payload.assignment.orderId, state: payload.assignment.state, handoffState: payload.assignment.handoff?.state, version: payload.assignment.version };
  return result;
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return jsonError("FORBIDDEN", "cross-site requests are forbidden", 403);
  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return jsonError("FORBIDDEN", "operator access is required", 403);
  const body = (await request.json().catch(() => null)) as { action?: unknown; phone?: unknown; orderId?: unknown; assignmentId?: unknown; expectedVersion?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId.trim() : "";
  const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : typeof body?.expectedVersion === "string" && /^[1-9]\d*$/.test(body.expectedVersion.trim()) ? Number(body.expectedVersion.trim()) : NaN;
  if (action === "recover" && (!assignmentId || !Number.isInteger(expectedVersion) || expectedVersion < 1)) return jsonError("INVALID_INPUT", "assignmentId and a positive expectedVersion are required for recovery", 400);
  const context = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  try {
		if (action === "admit") { const result = await admitCaptain({ contactPhoneE164: phone }, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "dispatch") { const result = await dispatchCaptainOffer(orderId, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "reassign") { const result = await reassignCaptainOffer(orderId, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "recover") { const result = await recoverCaptainDelivery(assignmentId, { ...context, expectedVersion }); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
    return jsonError("INVALID_INPUT", "a supported Captain operation is required", 400);
  } catch (error) {
    const payload = dshErrorPayload(error);
    return jsonError(payload.code, payload.message, dshHttpStatus(error));
  }
}
