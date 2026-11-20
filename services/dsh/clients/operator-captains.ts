import { DshPublicError, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

/** Private Operator review reads. DSH owns Captain standing; these do not admit
 * an Identity role, decide standing or expose candidate identity/contact data. */
export const captainStandingStatuses = ["PENDING", "APPROVED", "SUSPENDED", "REVOKED"] as const;
export type CaptainStandingStatus = typeof captainStandingStatuses[number];
export interface OperatorCaptainStanding {
  actorId: string;
  status: CaptainStandingStatus;
  version: number;
}
export interface OperatorCaptainStandingPage {
  items: OperatorCaptainStanding[];
  nextCursor?: string;
}
const captainCursor = /^[A-Za-z0-9_-]{1,512}$/;
export function isCaptainStandingActorId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value !== "." && value !== ".." &&
    value.trim() === value && !/[\r\n\t/\\]/.test(value) && !value.includes(String.fromCharCode(0)) &&
    !/[\uD800-\uDFFF]/u.test(value) && new TextEncoder().encode(value).byteLength <= 128;
}
function isCaptainStanding(value: unknown): value is OperatorCaptainStanding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && onlyKeys(v, ["actorId", "status", "version"]) &&
    isCaptainStandingActorId(v.actorId) && captainStandingStatuses.includes(v.status as CaptainStandingStatus) &&
    Number.isSafeInteger(v.version) && Number(v.version) >= 1;
}
export async function listOperatorCaptainStandings(
  baseUrl: string, bearer: string,
  options: { status?: CaptainStandingStatus; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<OperatorCaptainStandingPage> {
  const status = options.status ?? "PENDING";
  const limit = options.limit ?? 20;
  if (!captainStandingStatuses.includes(status) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    (options.cursor !== undefined && !captainCursor.test(options.cursor))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (options.signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  const params = new URLSearchParams({ status });
  if (options.limit !== undefined) params.set("limit", String(limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  const body = await privateOwnerRequest(baseUrl, `${dshOperations.listOperatorCaptainStandings.path}?${params}`, bearer, "GET", undefined, options.signal);
  const page = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!page || !onlyKeys(page, ["items", "nextCursor"]) || !Array.isArray(page.items) ||
    page.items.length > limit || !page.items.every(item => isCaptainStanding(item) && item.status === status) ||
    new Set(page.items.map(item => item.actorId)).size !== page.items.length ||
    (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !captainCursor.test(page.nextCursor)))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  if (options.signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return page as unknown as OperatorCaptainStandingPage;
}
export interface OperatorCaptainStandingChange {
  status: "APPROVED" | "SUSPENDED" | "REVOKED";
  expectedVersion: number;
  operationId: string;
  reason: string;
}

export async function changeOperatorCaptainStanding(
  baseUrl: string, actorId: string, bearer: string,
  change: OperatorCaptainStandingChange, signal?: AbortSignal,
): Promise<OperatorCaptainStanding> {
  if (!isCaptainStandingActorId(actorId) ||
    !["APPROVED", "SUSPENDED", "REVOKED"].includes(change.status) ||
    !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 1 ||
    !/^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) ||
    typeof change.reason !== "string" || change.reason.trim() !== change.reason ||
    Array.from(change.reason).length < 1 || Array.from(change.reason).length > 300) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const result = await privateOwnerRequest(baseUrl,
    dshOperations.changeCaptainStandingByAuthorizedOperator.path.replace("{actorId}", encodeURIComponent(actorId)), bearer, "PATCH", change, signal);
  if (!isCaptainStanding(result) || result.actorId !== actorId ||
    result.status !== change.status || result.version < change.expectedVersion) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result;
}

export async function getOperatorCaptainStanding(
  baseUrl: string, actorId: string, bearer: string, signal?: AbortSignal,
): Promise<OperatorCaptainStanding> {
  if (!isCaptainStandingActorId(actorId)) throw new DshPublicError(400, "INVALID_REQUEST");
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  const body = await privateOwnerRequest(baseUrl,
    dshOperations.getOperatorCaptainStanding.path.replace("{actorId}", encodeURIComponent(actorId)), bearer, "GET", undefined, signal);
  if (!isCaptainStanding(body) || body.actorId !== actorId) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return body;
}
