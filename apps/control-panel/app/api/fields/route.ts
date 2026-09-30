import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { admitField, approveFieldAdmission, authorizeDshFieldReenrollment, dshErrorPayload, dshHttpStatus, isDshClientError, listFieldAdmissions, provisionFieldAdmission, readFieldAdmissionByActor, reviewFieldAdmissionProfile, setDshFieldRoleEnabled, updateFieldAdmissionProfile } from "../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorSession, searchIdentityRoles } from "../../../src/server/identity/identity-bff";
import { operatorWorkspacePermissionDenied } from "../../../src/server/identity/operator-workspace-access";
import { verifySameOrigin } from "../../../src/server/security/csrf";

type WorkbenchCursor = Readonly<{ version: 1; phase: "candidates" | "accounts"; sourceCursor: string }>;

function encodeWorkbenchCursor(cursor: WorkbenchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeWorkbenchCursor(value: string): WorkbenchCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<WorkbenchCursor>;
    if (parsed.version !== 1 || (parsed.phase !== "candidates" && parsed.phase !== "accounts") || typeof parsed.sourceCursor !== "string" || parsed.sourceCursor.length > 512) return null;
    return { version: 1, phase: parsed.phase, sourceCursor: parsed.sourceCursor };
  } catch { return null; }
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "cross-site requests are forbidden" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const identity = await readOperatorSession();
  if (!identity) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.role !== "operator") return NextResponse.json({ error: { code: "FORBIDDEN", message: "operator access is required" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
  if (permissionDenied) return permissionDenied;
  const body = (await request.json().catch(() => null)) as { action?: unknown; fullNameAr?: unknown; contactPhoneE164?: unknown; admissionId?: unknown; actorId?: unknown; reason?: unknown; expectedVersion?: unknown; expectedAdmissionVersion?: unknown; expectedActorVersion?: unknown; expectedRoleVersion?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "admit";
  const admissionId = typeof body?.admissionId === "string" ? body.admissionId.trim() : "";
  const fullNameAr = typeof body?.fullNameAr === "string" ? body.fullNameAr.trim() : "";
  const actorId = typeof body?.actorId === "string" ? body.actorId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const rawExpectedVersion = body?.expectedVersion;
  const expectedVersion = typeof rawExpectedVersion === "number" ? rawExpectedVersion : typeof rawExpectedVersion === "string" && /^[1-9]\d*$/.test(rawExpectedVersion.trim()) ? Number(rawExpectedVersion.trim()) : NaN;
  const context = { operatorActorId: identity.subject, correlationId: randomUUID(), idempotencyKey: randomUUID() };
  if (["approve", "provision"].includes(action)) {
    if (!admissionId || (action === "approve" && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "admissionId and a positive expectedVersion are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const result = action === "approve" ? await approveFieldAdmission(admissionId, expectedVersion, context) : await provisionFieldAdmission(admissionId, context);
      return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
      return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (action === "review-profile") {
    const expectedVersion = Number(body?.expectedVersion);
    if (!admissionId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "admissionId and expectedVersion are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const result = await reviewFieldAdmissionProfile(admissionId, { ...context, expectedVersion });
      return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
      return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  if (action === "update-profile") {
    const expectedVersion = Number(body?.expectedVersion);
    if (!admissionId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "admissionId, fullNameAr, and expectedVersion are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const result = await updateFieldAdmissionProfile(admissionId, fullNameAr, { ...context, expectedVersion });
      return NextResponse.json(result.payload, { status: result.status, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const payload = isDshClientError(error) ? dshErrorPayload(error) : { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
      return NextResponse.json({ error: payload }, { status: isDshClientError(error) ? dshHttpStatus(error) : 502, headers: { "Cache-Control": "no-store" } });
    }
  }
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
  if (Array.from(fullNameAr).length < 2 || Array.from(fullNameAr).length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "full Arabic name and a valid E.164 phone are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await admitField({ fullNameAr, contactPhoneE164 }, context);
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
  const permissionDenied = operatorWorkspacePermissionDenied(identity, "partners");
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
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || enabled === null || sort === null || query.trim().length > 100 || cursor.length > 512) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "valid search, cursor, sort, limit, and enabled filters are required" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    if (params.get("scope") === "workbench") {
      const workbenchCursor = decodeWorkbenchCursor(cursor);
      if (cursor && !workbenchCursor) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "field workbench cursor is invalid" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const phase = workbenchCursor?.phase ?? "candidates";
      const items: Array<Readonly<{ kind: "candidate"; admission: Awaited<ReturnType<typeof listFieldAdmissions>>["admissions"][number] }> | Readonly<{ kind: "account"; account: Awaited<ReturnType<typeof searchIdentityRoles>>["items"][number] & { admission: Awaited<ReturnType<typeof readFieldAdmissionByActor>>["admission"] | null } }>> = [];
      let accountsCursor = "";
      if (phase === "candidates") {
        const candidates = await listFieldAdmissions(query, "pending", "created_desc", limit, workbenchCursor?.sourceCursor ?? "", { operatorActorId: identity.subject });
        items.push(...candidates.admissions.map((admission) => ({ kind: "candidate" as const, admission })));
        if (candidates.nextCursor) return NextResponse.json({ items, nextCursor: encodeWorkbenchCursor({ version: 1, phase: "candidates", sourceCursor: candidates.nextCursor }) }, { headers: { "Cache-Control": "no-store" } });
        if (items.length < limit) accountsCursor = "";
        else {
          const firstAccount = await searchIdentityRoles("field", query, 1, "", enabled ?? undefined, sort);
          return NextResponse.json({ items, nextCursor: firstAccount.items.length ? encodeWorkbenchCursor({ version: 1, phase: "accounts", sourceCursor: "" }) : undefined }, { headers: { "Cache-Control": "no-store" } });
        }
      } else accountsCursor = workbenchCursor?.sourceCursor ?? "";
      const accountLimit = Math.max(1, limit - items.length);
      const accounts = await searchIdentityRoles("field", query, accountLimit, accountsCursor, enabled ?? undefined, sort);
      const roster = await Promise.all(accounts.items.map(async (role) => {
        try {
          const result = await readFieldAdmissionByActor(role.actorId, { operatorActorId: identity.subject });
          return { kind: "account" as const, account: { ...role, admission: result.admission } };
        } catch (error) {
          if (isDshClientError(error) && dshHttpStatus(error) === 404) return { kind: "account" as const, account: { ...role, admission: null } };
          throw error;
        }
      }));
      items.push(...roster);
      const nextCursor = accounts.nextCursor ? encodeWorkbenchCursor({ version: 1, phase: "accounts", sourceCursor: accounts.nextCursor }) : undefined;
      return NextResponse.json({ items, nextCursor }, { headers: { "Cache-Control": "no-store" } });
    }
    const page = await searchIdentityRoles("field", query, limit, cursor, enabled, sort);
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
