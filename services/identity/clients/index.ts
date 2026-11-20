/**
 * Canonical Identity HTTP transport for sessions and direct Merchant admission.
 */
import { identityOperations } from "./generated/identity-operations.ts";

export { identityOperations } from "./generated/identity-operations.ts";
export type IdentityRole = "customer" | "merchant" | "captain" | "operator";
export interface VerifiedIdentitySession {
  actorId: string;
  role: IdentityRole;
  sessionExpiresAt: string;
}
export interface IssuedRoleSession {
  accessToken: string;
  sessionExpiresAt: string;
}
export type MerchantAdmission = IssuedRoleSession;
export class IdentityClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "IdentityClientError";
  }
}
const credential = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const allowedErrors = new Set([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "VERIFICATION_REQUIRED",
  "ALREADY_PROVISIONED", "MERCHANT_NOT_ACTIVE", "OWNER_UNAVAILABLE",
  "NOT_FOUND", "METHOD_NOT_ALLOWED",
  "PHONE_CHALLENGE_LIMIT", "CAPTAIN_NOT_APPROVED", "CAPTAIN_NOT_ACTIVE",
]);
const phoneTicket = /^[a-f0-9]{48}$/;
function originFor(baseUrl: string): URL {
  let root: URL;
  try { root = new URL(baseUrl); }
  catch { throw new IdentityClientError(0, "IDENTITY_ENDPOINT_INVALID"); }
  if (root.username || root.password || root.pathname !== "/" || root.search || root.hash ||
    !(root.protocol === "https:" ||
      (root.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(root.hostname)))) {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_UNSAFE");
  }
  return root;
}
function assertBearer(bearer: string): void {
  if (typeof bearer !== "string" || !credential.test(bearer)) {
    throw new IdentityClientError(401, "UNAUTHORIZED");
  }
}
function validDate(value: unknown): value is string {
  // Owner contract uses RFC3339 date-time, never date-only input normalized by Date.parse.
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}
function exactKeys(v: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(v).length === fields.length && Object.keys(v).every(k => fields.includes(k));
}
function sessionFrom(value: unknown): VerifiedIdentitySession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  const v = value as Record<string, unknown>;
  if (!exactKeys(v, ["actorId", "role", "sessionExpiresAt"]) ||
    typeof v.actorId !== "string" || v.actorId.length < 1 || v.actorId.length > 128 ||
    v.actorId.trim() !== v.actorId || /[\r\n\t]/.test(v.actorId) ||
    typeof v.role !== "string" || !["customer", "merchant", "captain", "operator"].includes(v.role) ||
    !validDate(v.sessionExpiresAt)) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  return v as unknown as VerifiedIdentitySession;
}
function issuedSessionFrom(value: unknown): IssuedRoleSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const v = value as Record<string, unknown>;
  if (!exactKeys(v, ["accessToken", "sessionExpiresAt"]) ||
    typeof v.accessToken !== "string" || !credential.test(v.accessToken) ||
    !validDate(v.sessionExpiresAt)) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return v as unknown as IssuedRoleSession;
}
async function ownerRequest(
  baseUrl: string, path: string, bearer: string | null,
  method: "GET" | "POST" | "DELETE", expectedStatus: number, signal?: AbortSignal,
  payload?: Record<string, string>,
): Promise<unknown> {
  if (bearer !== null) assertBearer(bearer);
  const mutation = method !== "GET"; // Revocation DELETE may commit before a transport failure.
  const root = originFor(baseUrl);
  const url = new URL(path, root);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, redirect: "error", credentials: "omit", cache: "no-store",
      signal: signal ?? null,
      headers: {
        Accept: "application/json",
        ...(bearer === null ? {} : { Authorization: "Bearer " + bearer }),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new IdentityClientError(0, mutation ? "OPERATION_RESULT_UNKNOWN" :
      signal?.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_NETWORK_UNAVAILABLE");
  }
  if (signal?.aborted) throw new IdentityClientError(0, mutation ?
    "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  if (response.status !== expectedStatus) {
    if (response.ok) throw new IdentityClientError(502, mutation ?
      "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
    let code = "OWNER_REQUEST_FAILED";
    try {
      const err: unknown = await response.json();
      if (err && typeof err === "object" && "error" in err &&
        typeof err.error === "string" && allowedErrors.has(err.error)) {
        code = err.error;
      }
    } catch { /* Never display arbitrary owner error content. */ }
    if (signal?.aborted) throw new IdentityClientError(0, mutation ?
      "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
    throw new IdentityClientError(response.status,
      mutation && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  const cacheDirectives = response.headers.get("Cache-Control")
    ?.split(",").map(part => part.trim().toLowerCase()) ?? [];
  if (expectedStatus === 204 && cacheDirectives.includes("no-store")) return undefined;
  const contentLength = response.headers.get("Content-Length");
  const boundedLength = contentLength === null ||
    (/^\d+$/.test(contentLength) && Number(contentLength) <= 16384);
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    !cacheDirectives.includes("no-store") || !boundedLength) {
    throw new IdentityClientError(502, mutation ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  try {
    const text = await response.text();
    if (text.length > 16384) throw new Error("Identity response too large");
    const body: unknown = JSON.parse(text);
    if (signal?.aborted) throw new Error("Stale response");
    return body;
  } catch {
    throw new IdentityClientError(502, mutation ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
}
export async function issueCustomerPhoneChallenge(
  baseUrl: string, phone: string, signal?: AbortSignal,
): Promise<string> {
  const result = await ownerRequest(baseUrl, identityOperations.issueCustomerPhoneChallenge.path, null,
    "POST", 201, signal, { phone });
  if (!result || typeof result !== "object" || !("ticket" in result) ||
    Object.keys(result).length !== 1 || typeof result.ticket !== "string" || !phoneTicket.test(result.ticket)) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result.ticket;
}

export async function verifyCustomerPhoneChallenge(
  baseUrl: string, ticket: string, code: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.verifyCustomerPhoneChallenge.path, null,
    "POST", 200, signal, { ticket, code }));
}

export async function revokeVerifiedIdentitySession(
  baseUrl: string, bearer: string, signal?: AbortSignal,
): Promise<void> {
  await ownerRequest(baseUrl, identityOperations.revokeCurrentIdentitySession.path, bearer, "DELETE", 204, signal);
}
export async function readVerifiedIdentitySession(
  baseUrl: string, bearer: string, signal?: AbortSignal,
): Promise<VerifiedIdentitySession> {
  return sessionFrom(await ownerRequest(baseUrl, identityOperations.getVerifiedIdentitySession.path, bearer, "GET", 200, signal));
}
/** Requires a verified Customer session. Never implies a DSH Store grant. */
export async function admitCurrentCustomerAsMerchant(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<MerchantAdmission> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.admitVerifiedCurrentCustomerAsMerchant.path,
    customerBearer, "POST", 201, signal));
}
/** Revokes previous Merchant sessions at Identity before issuing a new one. */
export async function resumeCurrentCustomerMerchantSession(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<MerchantAdmission> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.resumeVerifiedCurrentCustomerMerchantSession.path,
    customerBearer, "POST", 200, signal));
}
/** The DSH-approved Captain standing is checked again by Identity at issue time. */
export async function admitCurrentCustomerAsCaptain(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.admitVerifiedCustomerAsApprovedCaptain.path,
    customerBearer, "POST", 201, signal));
}
/** Re-entry rotates the existing Captain bearer without reactivating a role. */
export async function resumeCurrentCustomerCaptainSession(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.resumeApprovedCaptainRoleSession.path,
    customerBearer, "POST", 200, signal));
}
