import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitCaptain, dispatchCaptainOffer, dshErrorPayload, dshHttpStatus, isDshClientError, readCaptainAdmissionByActor, reassignCaptainOffer, recoverCaptainDelivery, setDshCaptainAvailability, setDshCaptainRoleEnabled } from "../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../src/server/identity/operator-workspace-access";
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
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "operations");
  if (permissionDenied) return permissionDenied;
  const body = (await request.json().catch(() => null)) as { action?: unknown; phone?: unknown; orderId?: unknown; assignmentId?: unknown; actorId?: unknown; available?: unknown; reason?: unknown; expectedVersion?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId.trim() : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const available = body?.available;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expectedVersion = typeof body?.expectedVersion === "number" ? body.expectedVersion : typeof body?.expectedVersion === "string" && /^[1-9]\d*$/.test(body.expectedVersion.trim()) ? Number(body.expectedVersion.trim()) : NaN;
  if (action === "recover" && (!assignmentId || !Number.isInteger(expectedVersion) || expectedVersion < 1)) return jsonError("INVALID_INPUT", "assignmentId and a positive expectedVersion are required for recovery", 400);
  const context = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  try {
		if (action === "activate" || action === "disable") {
			if (!actorId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Array.from(reason).length < 5 || Array.from(reason).length > 500) return jsonError("INVALID_INPUT", "actorId, current role version, and a reason of 5 to 500 characters are required", 400);
			await setDshCaptainRoleEnabled(actorId, { enabled: action === "activate", reason }, { ...context, expectedVersion });
			return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
		}
		if (action === "availability") {
			if (!actorId || typeof available !== "boolean" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Array.from(reason).length < 5 || Array.from(reason).length > 500) return jsonError("INVALID_INPUT", "actorId, desired availability, current DSH version, and a reason of 5 to 500 characters are required", 400);
			const result = await setDshCaptainAvailability(actorId, { available, reason }, { ...context, expectedVersion });
			return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } });
		}
		if (action === "admit") { const result = await admitCaptain({ contactPhoneE164: phone }, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "dispatch") { const result = await dispatchCaptainOffer(orderId, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "reassign") { const result = await reassignCaptainOffer(orderId, context); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
		if (action === "recover") { const result = await recoverCaptainDelivery(assignmentId, { ...context, expectedVersion }); return NextResponse.json(boundedResult(action, result.payload), { status: result.status, headers: { "Cache-Control": "no-store" } }); }
    return jsonError("INVALID_INPUT", "a supported Captain operation is required", 400);
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return jsonError(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return jsonError(payload.code, payload.message, identityHttpStatus(error));
  }
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return jsonError("UNAUTHENTICATED", "authentication is required", 401);
  if (identity.role !== "operator") return jsonError("FORBIDDEN", "operator access is required", 403);
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "operations");
  if (permissionDenied) return permissionDenied;
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? "";
  const rawSort = params.get("sort") ?? "phone_asc";
  const sort = rawSort === "phone_asc" || rawSort === "phone_desc" ? rawSort : null;
  const rawEnabled = params.get("enabled");
  const enabled = rawEnabled === null ? undefined : rawEnabled === "true" ? true : rawEnabled === "false" ? false : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || enabled === null || sort === null || query.trim().length > 100 || cursor.length > 512) return jsonError("INVALID_INPUT", "valid search, cursor, sort, limit, and enabled filters are required", 400);
  try {
    const page = await searchIdentityRoles("captain", query, limit, cursor, enabled, sort);
    const items = await Promise.all(page.items.map(async (role) => {
      try {
        const result = await readCaptainAdmissionByActor(role.actorId, { operatorActorId: identity.subject });
        return { ...role, admission: result.admission };
      } catch (error) {
        if (isDshClientError(error) && dshHttpStatus(error) === 404) return { ...role, admission: null };
        throw error;
      }
    }));
    return NextResponse.json({ items, limit: page.limit, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isDshClientError(error)) {
      const payload = dshErrorPayload(error);
      return jsonError(payload.code, payload.message, dshHttpStatus(error));
    }
    const payload = identityErrorPayload(error);
    return jsonError(payload.code, payload.message, identityHttpStatus(error));
  }
}
