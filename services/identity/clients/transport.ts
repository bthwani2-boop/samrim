import { identityOperations } from "./generated/identity-operations.ts";
import type { IssuedRoleSession, VerifiedIdentitySession } from "./types.ts";

export class IdentityClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "IdentityClientError";
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Payload = Record<string, string | number>;

export const credential = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const maxOwnerBytes = 16_384;
const bodyDeadlineMs = 5_000;
const allowedErrors = new Set([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "VERIFICATION_REQUIRED",
  "ALREADY_PROVISIONED", "MERCHANT_NOT_ACTIVE", "OWNER_UNAVAILABLE",
  "NOT_FOUND", "METHOD_NOT_ALLOWED", "CONFLICT",
  "PHONE_CHALLENGE_LIMIT", "CAPTAIN_NOT_APPROVED", "CAPTAIN_NOT_ACTIVE",
]);

function endpoint(baseUrl: string, path: string): URL {
  let root: URL;
  try {
    root = new URL(baseUrl);
  } catch {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_INVALID");
  }
  if (root.username || root.password || root.pathname !== "/" || root.search || root.hash ||
    !(root.protocol === "https:" ||
      (root.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(root.hostname)))) {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_UNSAFE");
  }
  const url = new URL(path, root);
  if (!path.startsWith("/") || path.startsWith("//") || url.origin !== root.origin) {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_UNSAFE");
  }
  return url;
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

export function exactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every(key => fields.includes(key));
}

function validOwnerActorId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      new TextEncoder().encode(value).length > 128) return false;
  // Match Identity Go's utf8.ValidString and unicode.IsControl checks.
  return Array.from(value).every(char => {
    const point = char.codePointAt(0);
    return point !== undefined && point >= 32 &&
      (point < 127 || point > 159) && (point < 0xd800 || point > 0xdfff);
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function sessionFrom(value: unknown): VerifiedIdentitySession {
  const session = record(value);
  if (!session || !exactKeys(session, ["actorId", "role", "sessionExpiresAt"]) ||
    !validOwnerActorId(session.actorId) ||
    typeof session.role !== "string" || !["customer", "merchant", "captain", "operator"].includes(session.role) ||
    !validDate(session.sessionExpiresAt)) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  return session as unknown as VerifiedIdentitySession;
}

export function issuedSessionFrom(value: unknown): IssuedRoleSession {
  const session = record(value);
  if (!session || !exactKeys(session, ["accessToken", "sessionExpiresAt"]) ||
    typeof session.accessToken !== "string" || !credential.test(session.accessToken) ||
    !validDate(session.sessionExpiresAt)) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return session as unknown as IssuedRoleSession;
}

// One transport owns the absolute request budgets. The short cleanup budget
// applies only to a rejected persistent-family handoff, never an ordinary write.
function requestBudget(method: Method, path: string, cleanup: boolean): number {
  if (method === "DELETE" && path === identityOperations.revokePersistentIdentitySession.path) {
    return cleanup ? 2_000 : 5_000;
  }
  if ((method === "GET" && path === identityOperations.getVerifiedIdentitySession.path) ||
      (method === "POST" && path === identityOperations.establishPersistentIdentitySession.path)) {
    return 5_000;
  }
  return 10_000;
}

// Race even non-cooperative native bridges against cancellation. The body
// also retains its independent maximum read duration inside the total budget.
async function awaitOwnerOperation<T>(
  start: () => Promise<T>, signal: AbortSignal, timeoutMs?: number,
): Promise<T> {
  if (signal.aborted) throw new Error("Owner operation cancelled");
  let onAbort: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Owner operation cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      deadline = setTimeout(() => reject(new Error("Owner body deadline exceeded")), timeoutMs);
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("Owner operation cancelled");
      return start();
    }), stopped]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (deadline !== undefined) clearTimeout(deadline);
  }
}

// A synchronous native exception and an asynchronous cancellation rejection
// both stay inside the same best-effort cleanup boundary.
async function discardStream(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Failed cleanup must not replace the authoritative request outcome.
  }
}

function discardBody(response: Response): void {
  void discardStream(() => {
    const body = response.body;
    return body && !body.locked ? body : null;
  });
}

function noStore(response: Response): boolean {
  return response.headers.get("Cache-Control")?.split(",")
    .some(part => part.trim().toLowerCase() === "no-store") ?? false;
}

function jsonMetadata(response: Response): boolean {
  const length = response.headers.get("Content-Length");
  return noStore(response) &&
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "application/json" &&
    (length === null || (/^\d+$/.test(length) && Number(length) <= maxOwnerBytes));
}

async function readOwnerJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = response.body;
  if (!jsonMetadata(response) || !body?.getReader) {
    discardBody(response);
    throw new Error("Invalid Identity reply metadata or stream");
  }
  const reader = body.getReader();
  let complete = false;
  try {
    const value = await awaitOwnerOperation(async () => {
      const bytes = new Uint8Array(maxOwnerBytes);
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength > maxOwnerBytes - size) throw new Error("Oversized Identity reply");
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    }, signal, bodyDeadlineMs);
    complete = true;
    return value;
  } finally {
    if (!complete) void discardStream(() => reader);
    reader.releaseLock();
  }
}

function interrupted(mutation: boolean, caller?: AbortSignal): IdentityClientError {
  return new IdentityClientError(0, mutation ? "OPERATION_RESULT_UNKNOWN" :
    caller?.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_NETWORK_UNAVAILABLE");
}

function invalidReply(mutation: boolean): IdentityClientError {
  return new IdentityClientError(502, mutation ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
}

async function exchange(
  url: URL, bearer: string | null, method: Method, expectedStatus: number,
  signal: AbortSignal, caller?: AbortSignal, payload?: Payload,
): Promise<unknown> {
  const mutation = method !== "GET";
  let response: Response;
  try {
    response = await awaitOwnerOperation(async () => {
      const reply = await fetch(url.toString(), {
        method, redirect: "error", credentials: "omit", cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          ...(bearer === null ? {} : { Authorization: "Bearer " + bearer }),
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (signal.aborted) discardBody(reply);
      return reply;
    }, signal);
  } catch {
    throw interrupted(mutation, caller);
  }
  if (signal.aborted) {
    discardBody(response);
    throw interrupted(mutation, caller);
  }
  if (response.status !== expectedStatus) {
    if (response.ok) {
      discardBody(response);
      throw invalidReply(mutation);
    }
    let code = "OWNER_REQUEST_FAILED";
    try {
      const failure = record(await readOwnerJSON(response, signal));
      if (typeof failure?.error === "string" && allowedErrors.has(failure.error)) code = failure.error;
    } catch { /* Never expose an unverified owner message. */ }
    if (signal.aborted) throw interrupted(mutation, caller);
    throw new IdentityClientError(response.status,
      mutation && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  if (expectedStatus === 204) {
    discardBody(response);
    if (!noStore(response)) throw invalidReply(mutation);
    return undefined;
  }
  try {
    const value = await readOwnerJSON(response, signal);
    if (signal.aborted) throw interrupted(mutation, caller);
    return value;
  } catch {
    if (signal.aborted) throw interrupted(mutation, caller);
    throw invalidReply(mutation);
  }
}

export async function ownerRequest(
  baseUrl: string, path: string, bearer: string | null,
  method: Method, expectedStatus: number, caller?: AbortSignal,
  payload?: Payload, cleanup = false,
): Promise<unknown> {
  if (bearer !== null && (typeof bearer !== "string" || !credential.test(bearer))) {
    throw new IdentityClientError(401, "UNAUTHORIZED");
  }
  const url = endpoint(baseUrl, path);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  caller?.addEventListener("abort", cancel, { once: true });
  if (caller?.aborted) cancel();
  const timer = setTimeout(cancel, requestBudget(method, path, cleanup));
  try {
    return await exchange(url, bearer, method, expectedStatus, controller.signal, caller, payload);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", cancel);
  }
}
