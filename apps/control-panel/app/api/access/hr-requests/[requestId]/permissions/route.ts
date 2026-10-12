import { randomUUID } from "node:crypto";
import type { OperatorPermission } from "@bthwani/identity";
import { NextResponse } from "next/server";
import { dshErrorPayload, dshHttpStatus, isDshClientError, readHRAccessRequest } from "../../../../../../src/server/dsh/dsh-bff";
import { identityErrorPayload, identityHttpStatus, readOperatorPermission, readOperatorSession, setOperatorPermission } from "../../../../../../src/server/identity/identity-bff";
import { verifySameOrigin } from "../../../../../../src/server/security/csrf";
import { operatorWorkspacePermissions } from "../../../../../../src/session/operator-permissions";

type Params = { params: Promise<{ requestId: string }> };
const names = operatorWorkspacePermissions.map(({ key }) => key);
type IdentityFailure = Readonly<{ source: "identity"; error: unknown }>;
const identityFailure = (error: unknown): IdentityFailure => ({ source: "identity", error });
const denied = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
async function review(requestId: string) {
  const root = await readOperatorSession();
  if (!root) return { error: denied(401, "UNAUTHENTICATED", "sign in required") } as const;
  if (root.role !== "operator" || !root.canManageOperatorPermissions) return { error: denied(403, "FORBIDDEN", "Root Owner required") } as const;
  if (!/^hreq_[a-f0-9]{32}$/.test(requestId)) return { error: denied(400, "INVALID_INPUT", "invalid request") } as const;
  const { request } = await readHRAccessRequest(requestId, { operatorActorId: root.subject });
  if (request.state !== "identity_profile_created" || !request.operatorActorId)
    return { error: denied(409, "NOT_ADMITTED", "employee needs an admitted Identity operator link") } as const;
  const context = { operatorActorId: root.subject, correlationId: randomUUID() };
  const permissions = await Promise.all(names.map((key) => readOperatorPermission(request.operatorActorId as string, key, context)))
    .catch((error: unknown) => { throw identityFailure(error); });
  return { request, permissions, context };
}
function failure(error: unknown) {
  if (error && typeof error === "object" && "source" in error && error.source === "identity") {
    const original = (error as IdentityFailure).error;
    const payload = identityErrorPayload(original);
    return denied(identityHttpStatus(original), payload.code, payload.message);
  }
  if (isDshClientError(error)) {
    const p = dshErrorPayload(error);
    return denied(dshHttpStatus(error), p.code, p.message);
  }
  const p = identityErrorPayload(error);
  return denied(identityHttpStatus(error), p.code, p.message);
}
function snapshot(request: { id: string; operatorActorId?: string; version: number; requestedPermissions: readonly string[] },
  rows: ReadonlyArray<{ permission: string; enabled: boolean; version: number }>) {
  return { requestId: request.id, actorId: request.operatorActorId, requestVersion: request.version,
    requestedPermissions: request.requestedPermissions, grantedPermissions: rows.filter((row) => row.enabled).map((row) => row.permission),
    permissions: rows.map(({ permission, enabled, version }) => ({ permission, enabled, version })) };
}
export async function GET(_request: Request, context: Params) {
  try {
    const state = await review((await context.params).requestId);
    if ("error" in state) return state.error;
    return NextResponse.json(snapshot(state.request, state.permissions), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Params) {
  if (!verifySameOrigin(request)) return denied(403, "FORBIDDEN", "cross-site mutation blocked");
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const permissions = body?.approvedPermissions;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const version = body?.expectedVersion;
  if (!body || Object.keys(body).some((key) => !["approvedPermissions", "reason", "expectedVersion"].includes(key)) ||
    !Array.isArray(permissions) || permissions.some((key) => typeof key !== "string" || !names.includes(key as OperatorPermission)) ||
    new Set(permissions).size !== permissions.length || !Number.isSafeInteger(version) || (version as number) < 1 ||
    Array.from(reason).length < 8 || Array.from(reason).length > 500)
    return denied(400, "INVALID_INPUT", "explicit approval, request version and reason required");
  try {
    const state = await review((await context.params).requestId);
    if ("error" in state) return state.error;
    const { request: hrRequest, context: authorized } = state;
    if (hrRequest.version !== version || permissions.some((p) => !hrRequest.requestedPermissions.includes(p)))
      return denied(409, "CONFLICT", "HR request changed or permission not requested");
    const actorId = hrRequest.operatorActorId;
    if (!actorId) return denied(409, "NOT_ADMITTED", "no Identity actor link");
    const chosen = new Set<string>(permissions);
    const updated = [...state.permissions];
    for (const existing of state.permissions) {
      if (!hrRequest.requestedPermissions.includes(existing.permission) || existing.enabled === chosen.has(existing.permission)) continue;
      const changed = await setOperatorPermission(actorId, existing.permission, chosen.has(existing.permission),
        "HR request " + hrRequest.id + ": " + reason, { ...authorized, expectedVersion: existing.version })
        .catch((error: unknown) => { throw identityFailure(error); });
      const index = updated.findIndex((row) => row.permission === existing.permission);
      if (index !== -1) updated[index] = changed;
    }
    return NextResponse.json(snapshot(hrRequest, updated), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
