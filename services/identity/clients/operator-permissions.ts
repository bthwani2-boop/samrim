import { identityOperations } from "./generated/identity-operations.ts";
import { exactKeys, IdentityClientError, ownerRequest } from "./transport.ts";
import type { IdentityOperatorPermission, OperatorPermissionChange, OperatorPermissionRevision } from "./types.ts";
import { identityOperatorPermissions } from "./types.ts";

export function isOperatorActorId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

/** Identity independently verifies the original Operator and records each command once. */
export async function changeOriginalOperatorPermission(
  baseUrl: string, bearer: string, targetActorId: string, permission: IdentityOperatorPermission,
  command: OperatorPermissionChange, signal?: AbortSignal,
): Promise<OperatorPermissionRevision> {
  const { state, expectedVersion, operationId, reason } = command;
  if (!isOperatorActorId(targetActorId) || !identityOperatorPermissions.includes(permission) ||
      (state !== "ACTIVE" && state !== "REVOKED") || !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(operationId) || typeof reason !== "string") {
    throw new IdentityClientError(400, "INVALID_REQUEST");
  }
  const operation = identityOperations.manageOriginalOperatorPermission;
  const path = operation.path.replace("{actorId}", targetActorId).replace("{permission}", permission);
  const body = await ownerRequest(baseUrl, path, bearer, operation.method, 200, signal,
    { state, expectedVersion, operationId, reason });
  const record = body as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      !exactKeys(record, ["targetActorId", "permission", "state", "version"]) ||
      record.targetActorId !== targetActorId || record.permission !== permission ||
      record.state !== state || record.version !== expectedVersion + 1) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return { permission, state, version: expectedVersion + 1 };
}

/** Identity checks the current original Operator before reading the requested actor. */
export async function reviewOriginalOperatorPermissions(
  baseUrl: string, bearer: string, targetActorId: string, signal?: AbortSignal,
): Promise<OperatorPermissionRevision[]> {
  if (!isOperatorActorId(targetActorId)) throw new IdentityClientError(400, "INVALID_REQUEST");
  const operation = identityOperations.reviewOriginalOperatorPermissions;
  const body = await ownerRequest(baseUrl, operation.path.replace("{actorId}", targetActorId),
    bearer, operation.method, 200, signal);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  const envelope = body as Record<string, unknown>;
  if (!exactKeys(envelope, ["targetActorId", "permissions"]) || envelope.targetActorId !== targetActorId ||
      !Array.isArray(envelope.permissions) || envelope.permissions.length > identityOperatorPermissions.length) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  const seen = new Set<IdentityOperatorPermission>();
  return envelope.permissions.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    const record = row as Record<string, unknown>;
    const permission = identityOperatorPermissions.find(item => item === record.permission);
    if (!exactKeys(record, ["permission", "state", "version"]) || !permission || seen.has(permission) ||
        (record.state !== "ACTIVE" && record.state !== "REVOKED") ||
        typeof record.version !== "number" || !Number.isSafeInteger(record.version) || record.version < 1) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    seen.add(permission);
    return { permission, state: record.state, version: record.version };
  });
}
