// Only the explicitly isolated Operator test BFF uses these helpers.
// A bearer issued by Identity is never delivered to browser JavaScript.
export const OPERATOR_COOKIE = "bthwani_operator_session";

export type OperatorPasskeyConfig = {
  browserOrigin: string;
  identityOrigin: string;
};

type Settings = Record<string, string | undefined>;

const validBase64Url = /^[A-Za-z0-9_-]+$/;
const localHostnames = new Set(["localhost", "127.0.0.1"]);

function localOrigin(raw: string | undefined, allowedHosts: Set<string>): string | null {
  if (!raw?.startsWith("http://")) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "http:" ||
      !allowedHosts.has(parsed.hostname) ||
      !parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== raw
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveIsolatedOperatorConfig(env: Settings): OperatorPasskeyConfig | null {
  if (env.BTHWANI_ISOLATED_TEST_MODE !== "true" ||
      env.OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF !== "true") return null;
  const browserOrigin = localOrigin(
    env.OPERATOR_PASSKEY_BROWSER_ORIGIN,
    new Set(["localhost"]),
  );
  const identityOrigin = localOrigin(
    env.OPERATOR_PASSKEY_IDENTITY_ORIGIN,
    localHostnames,
  );
  return browserOrigin && identityOrigin ? { browserOrigin, identityOrigin } : null;
}

export function isTrustedOperatorRequest(request: Request, config: OperatorPasskeyConfig): boolean {
  if (request.method !== "POST" || request.headers.get("origin") !== config.browserOrigin) return false;
  const target = new URL(request.url);
  if (target.origin !== config.browserOrigin || target.search !== "" ||
      request.headers.get("host") !== target.host) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== target.host) return false;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto && forwardedProto !== "http") return false;
  for (const key of ["authorization", "x-actor-id", "x-operator-role", "x-role"]) {
    if (request.headers.has(key)) return false;
  }
  return true;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validBinary(value: unknown, minimum = 1): value is string {
  return typeof value === "string" && value.length >= minimum &&
    value.length <= 1024 && validBase64Url.test(value);
}

export function parsePasskeyOptions(value: unknown): unknown | null {
  const envelope = object(value);
  const options = object(envelope?.options);
  const publicKey = object(options?.publicKey);
  const ceremonyId = envelope?.ceremonyId;
  if (!validBinary(ceremonyId, 43) || ceremonyId.length !== 43 ||
      !validBinary(publicKey?.challenge, 43) || publicKey?.rpId !== "localhost" ||
      publicKey?.userVerification !== "required") return null;
  return value;
}

export type IssuedOperatorToken = {
  accessToken: string;
  sessionExpiresAt: string;
};

export type VerifiedOperatorPrincipal = {
  actorId: string;
  role: "operator";
  sessionExpiresAt: string;
};

export function cookieLifetimeSeconds(value: string, now = Date.now()): number {
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= now) return 0;
  return Math.max(0, Math.min(1800, Math.floor((expiry - now) / 1000)));
}

export function parseIssuedOperatorToken(
  value: unknown,
  now = Date.now(),
): IssuedOperatorToken | null {
  const body = object(value);
  if (!body || !validBinary(body.accessToken, 43) ||
      body.accessToken.length !== 43 || typeof body.sessionExpiresAt !== "string") return null;
  const lifetime = Date.parse(body.sessionExpiresAt) - now;
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 31 * 60 * 1000) return null;
  return { accessToken: body.accessToken, sessionExpiresAt: body.sessionExpiresAt };
}

export function parseVerifiedOperatorPrincipal(
  value: unknown,
  token: IssuedOperatorToken,
  now = Date.now(),
): VerifiedOperatorPrincipal | null {
  const principal = object(value);
  if (!principal || typeof principal.actorId !== "string" || principal.actorId.length < 1 ||
      principal.actorId.length > 256 || principal.role !== "operator" ||
      typeof principal.sessionExpiresAt !== "string" ||
      Date.parse(principal.sessionExpiresAt) !== Date.parse(token.sessionExpiresAt) ||
      cookieLifetimeSeconds(principal.sessionExpiresAt, now) <= 0) return null;
  return {
    actorId: principal.actorId,
    role: "operator",
    sessionExpiresAt: principal.sessionExpiresAt,
  };
}

const allowedOwnerPaths = new Set([
  "/v1/operators/passkey/authentication/options",
  "/v1/operators/passkey/authentication",
  "/v1/sessions/current",
]);

export async function operatorIdentityRequest(
  config: OperatorPasskeyConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!allowedOwnerPaths.has(path)) throw new Error("Unexpected Identity owner route");
  return fetch(config.identityOrigin + path, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
}

export async function boundedResponseJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty Identity owner reply");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("Oversized Identity owner reply");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
}

export async function boundedRequestBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 65536)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return null;
  const combined = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    combined.set(chunk, pos);
    pos += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return null;
  }
}
