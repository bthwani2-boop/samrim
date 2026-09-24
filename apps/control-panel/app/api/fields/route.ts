import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitField, authorizeDshFieldReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError, readFieldAdmissionByActor, setDshFieldRoleEnabled } from "../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../src/server/security/csrf";

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const body = (await request.json().catch(() => null)) as { action?: unknown; contactPhoneE164?: unknown; actorId?: unknown; reason?: unknown; expectedVersion?: unknown; expectedAdmissionVersion?: unknown; expectedActorVersion?: unknown; expectedRoleVersion?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "admit";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawExpectedVersion = body?.expectedVersion;
  const expectedVersion = typeof rawExpectedVersion === "number" ? rawExpectedVersion : typeof rawExpectedVersion === "string" && /^[1-9]\d*$/.test(rawExpectedVersion.trim()) ? Number(rawExpectedVersion.trim()) : NaN;
  const context = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  if (action === "activate" || action === "disable") {
    if (!actorId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Array.from(reason).length < 5 || Array.from(reason).length > 500) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "actorId, current role version, and a reason of 5 to 500 characters are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      await setDshFieldRoleEnabled(actorId, { enabled: action === "activate", reason }, { ...context, expectedVersion });
      return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "IDENTITY_INTERNAL_ERROR", message: "identity request failed" };
      return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (action === "reenroll") {
    const expectedAdmissionVersion = Number(body?.expectedAdmissionVersion);
    const expectedActorVersion = Number(body?.expectedActorVersion);
    const expectedRoleVersion = Number(body?.expectedRoleVersion);
    if (!actorId || !Number.isSafeInteger(expectedAdmissionVersion) || expectedAdmissionVersion < 1 || !Number.isSafeInteger(expectedActorVersion) || expectedActorVersion < 1 || !Number.isSafeInteger(expectedRoleVersion) || expectedRoleVersion < 1 || Array.from(reason).length < 5 || Array.from(reason).length > 500) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "actorId, current actor, role, and DSH admission versions, and a reason of 5 to 500 characters are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      await authorizeDshFieldReenrollment(actorId, { expectedActorVersion, expectedRoleVersion, reason }, { operatorActorId: identity.subject, correlationId: randomUUID(), expectedAdmissionVersion });
      return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
      return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (action !== "admit") return NextResponse.json({ error: { code: "INVALID_INPUT", message: "a supported Field operation is required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const contactPhoneE164 = typeof body?.contactPhoneE164 === "string" ? body.contactPhoneE164.trim() : "";
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "a valid E.164 phone is required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await admitField({ contactPhoneE164 }, context);
    return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
    return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: Request) {
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit") ?? "25";
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const query = params.get("q") ?? "";
  const cursor = params.get("cursor") ?? "";
  const rawEnabled = params.get("enabled");
  const enabled = rawEnabled === null ? undefined : rawEnabled === "true" ? true : rawEnabled === "false" ? false : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || enabled === null || query.trim().length > 100 || cursor.length > 512) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "valid search, cursor, limit, and enabled filters are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const page = await searchIdentityRoles("field", query, limit, cursor, enabled);
    const items = await Promise.all(page.items.map(async (role) => {
      try {
        const result = await readFieldAdmissionByActor(role.actorId, { operatorActorId: identity.subject });
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
      return NextResponse.json({ error: payload }, { status: dshHttpStatus(error), headers: { "Cache-Control": "no-store" } });
    }
    const payload = identityErrorPayload(error);
    return NextResponse.json({ error: payload }, { status: identityHttpStatus(error), headers: { "Cache-Control": "no-store" } });
  }
}
