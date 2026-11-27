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
type Representation = "json" | "empty";
type RequestScope = Readonly<{ signal: AbortSignal; caller: AbortSignal | undefined; mutation: boolean }>;

export const credential = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const responseByteLimit = 16_384;
const responseBodyBudget = 5_000;
const ownerErrors = new Set([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "VERIFICATION_REQUIRED",
  "ALREADY_PROVISIONED", "MERCHANT_NOT_ACTIVE", "OWNER_UNAVAILABLE",
  "NOT_FOUND", "METHOD_NOT_ALLOWED", "CONFLICT",
  "PHONE_CHALLENGE_LIMIT", "CAPTAIN_NOT_APPROVED", "CAPTAIN_NOT_ACTIVE",
]);

function endpoint(origin: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_INVALID");
  }
  const localHttp = base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "10.0.2.2"].includes(base.hostname);
  if (!(base.protocol === "https:" || localHttp) || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash ||
      !path.startsWith("/") || path.startsWith("//")) {
    throw new IdentityClientError(0, "IDENTITY_ENDPOINT_UNSAFE");
  }
  const target = new URL(path, base);
  if (target.origin !== base.origin) throw new IdentityClientError(0, "IDENTITY_ENDPOINT_UNSAFE");
  return target;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function exactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function validActorId(value: unknown): value is string {
  // The owner uses Go strings.TrimSpace, unicode.IsControl and valid UTF-8.
  return typeof value === "string" && value.length > 0 &&
    !/^\p{White_Space}|\p{White_Space}$/u.test(value) &&
    !/[\p{Cc}\p{Cs}]/u.test(value) && new TextEncoder().encode(value).length <= 128;
}

export function sessionFrom(value: unknown): VerifiedIdentitySession {
  const session = record(value);
  if (!session || !exactKeys(session, ["actorId", "role", "sessionExpiresAt"]) ||
      !validActorId(session.actorId) || typeof session.role !== "string" ||
      !["customer", "merchant", "captain", "operator"].includes(session.role) ||
      !validDate(session.sessionExpiresAt)) throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  return session as unknown as VerifiedIdentitySession;
}

export function issuedSessionFrom(value: unknown): IssuedRoleSession {
  const session = record(value);
  if (!session || !exactKeys(session, ["accessToken", "sessionExpiresAt"]) ||
      typeof session.accessToken !== "string" || !credential.test(session.accessToken) ||
      !validDate(session.sessionExpiresAt)) throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  return session as unknown as IssuedRoleSession;
}

function requestBudget(method: Method, path: string, cleanup: boolean): number {
  const operations = identityOperations;
  if (method === "DELETE" && path === operations.revokePersistentIdentitySession.path) {
    return cleanup ? 2_000 : 5_000;
  }
  if ((method === "GET" && path === operations.getVerifiedIdentitySession.path) ||
      (method === "POST" && path === operations.establishPersistentIdentitySession.path)) return 5_000;
  return 10_000;
}

function interrupted(scope: RequestScope): IdentityClientError {
  return new IdentityClientError(0, scope.mutation ? "OPERATION_RESULT_UNKNOWN" :
    scope.caller?.aborted ? "OWNER_RESPONSE_STALE" : "OWNER_NETWORK_UNAVAILABLE");
}

function invalidReply(scope: RequestScope): IdentityClientError {
  return new IdentityClientError(502, scope.mutation ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
}

async function within<T>(signal: AbortSignal, run: () => Promise<T>, bodyBudget?: number): Promise<T> {
  if (signal.aborted) throw new Error("Owner request ended");
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new Error("Owner request ended"));
    signal.addEventListener("abort", stop, { once: true });
    if (bodyBudget !== undefined) timer = setTimeout(stop, bodyBudget);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("Owner request ended");
      return run();
    }), deadline]);
  } finally {
    if (stop) signal.removeEventListener("abort", stop);
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function discard(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try { await acquire()?.cancel(); } catch { /* Cleanup cannot change owner evidence. */ }
}

function discardReply(reply: Response): void {
  void discard(() => {
    const stream = reply.body;
    return stream && !stream.locked ? stream : null;
  });
}

function admitsRepresentation(headers: Headers, representation: Representation): boolean {
  // Identity OpenAPI and Go owner emit the single no-store directive.
  // Never treat a comma inside an extension's quoted value as that directive.
  if (headers.get("Cache-Control")?.toLowerCase() !== "no-store") return false;
  const declared = headers.get("Content-Length");
  if (representation === "empty") {
    return (declared === null || declared === "0") && !headers.has("Transfer-Encoding");
  }
  return headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "application/json" &&
    (declared === null || (/^\d+$/.test(declared) && Number(declared) <= responseByteLimit));
}

async function receive(reply: Response, representation: Representation, signal: AbortSignal): Promise<unknown> {
  if (!admitsRepresentation(reply.headers, representation)) {
    discardReply(reply);
    throw new Error("Invalid owner representation");
  }
  const body = reply.body;
  // Browser fetch uses null for an empty response; Expo fetch exposes a stream.
  if (representation === "empty" && body === null) return undefined;
  if (!body?.getReader) {
    discardReply(reply);
    throw new Error("Missing owner byte stream");
  }
  const reader = body.getReader();
  let completed = false;
  try {
    const expires = performance.now() + responseBodyBudget;
    const limit = representation === "empty" ? 0 : responseByteLimit;
    const data = await within(signal, async () => {
      const bytes = new Uint8Array(limit);
      let size = 0;
      const assertCurrent = () => {
        if (signal.aborted || performance.now() >= expires) throw new Error("Owner body deadline");
      };
      for (;;) {
        assertCurrent();
        const chunk = await reader.read();
        assertCurrent();
        if (chunk.done) break;
        if (chunk.value.byteLength > limit - size) throw new Error("Owner byte limit");
        bytes.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      return representation === "empty" ? undefined :
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown;
    }, responseBodyBudget);
    completed = true;
    return data;
  } finally {
    if (!completed) void discard(() => reader);
    reader.releaseLock();
  }
}

async function dispatch(
  target: URL, method: Method, bearer: string | null, payload: Payload | undefined, scope: RequestScope,
): Promise<Response> {
  try {
    return await within(scope.signal, async () => {
      // Expo's installed native global uses expo/fetch; explicit request
      // metadata also reaches transports which do not implement Request.cache.
      const response = await fetch(target.toString(), {
        method, signal: scope.signal, redirect: "error", credentials: "omit", cache: "no-store",
        headers: {
          Accept: "application/json", "Cache-Control": "no-store",
          ...(bearer === null ? {} : { Authorization: "Bearer " + bearer }),
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (scope.signal.aborted) discardReply(response);
      return response;
    });
  } catch {
    throw interrupted(scope);
  }
}

async function admit(reply: Response, expectedStatus: number, scope: RequestScope): Promise<unknown> {
  if (scope.signal.aborted) {
    discardReply(reply);
    throw interrupted(scope);
  }
  if (reply.status === expectedStatus) {
    try {
      const data = await receive(reply, expectedStatus === 204 ? "empty" : "json", scope.signal);
      if (scope.signal.aborted) throw interrupted(scope);
      return data;
    } catch {
      throw scope.signal.aborted ? interrupted(scope) : invalidReply(scope);
    }
  }
  if (reply.ok) {
    discardReply(reply);
    throw invalidReply(scope);
  }
  let code = "OWNER_REQUEST_FAILED";
  try {
    const failure = record(await receive(reply, "json", scope.signal));
    if (typeof failure?.error === "string" && ownerErrors.has(failure.error)) code = failure.error;
  } catch { /* Never admit an unverified error description. */ }
  if (scope.signal.aborted) throw interrupted(scope);
  throw new IdentityClientError(reply.status,
    scope.mutation && reply.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
}

export async function ownerRequest(
  baseUrl: string, path: string, bearer: string | null,
  method: Method, expectedStatus: number, caller?: AbortSignal,
  payload?: Payload, cleanup = false,
): Promise<unknown> {
  if (bearer !== null && (typeof bearer !== "string" || !credential.test(bearer))) {
    throw new IdentityClientError(401, "UNAUTHORIZED");
  }
  const target = endpoint(baseUrl, path);
  const lifetime = new AbortController();
  const scope: RequestScope = { signal: lifetime.signal, caller, mutation: method !== "GET" };
  const stop = () => lifetime.abort();
  caller?.addEventListener("abort", stop, { once: true });
  if (caller?.aborted) stop();
  const deadline = setTimeout(stop, requestBudget(method, path, cleanup));
  try {
    return await admit(await dispatch(target, method, bearer, payload, scope), expectedStatus, scope);
  } finally {
    clearTimeout(deadline);
    caller?.removeEventListener("abort", stop);
  }
}
