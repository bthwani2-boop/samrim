import {
  establishPersistentIdentitySession,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokePersistentIdentitySession,
  revokeVerifiedIdentitySession,
  rotatePersistentIdentitySession,
  type VerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";
import { bearerForCustomerRequest as bearerFor, customerCookieName as cookieName } from "../../src/features/access/customer-session-cookie.ts";

/** Customer's test-only, same-origin BFF. Only Identity issues and revokes sessions. */
const noStore = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function configuredOwner(request: Request) {
  const host = new URL(request.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  return process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN ?? null;
}

function json(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers(noStore);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}

function cookieFor(request: Request, bearer: string, seconds: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${bearer}; Path=/api/customer-auth; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}

const refreshCookieName = `${cookieName}.refresh`;
function refreshFrom(request: Request): string | null {
  const value = request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(refreshCookieName + "="))?.slice(refreshCookieName.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function refreshCookieFor(request: Request, token: string, expiry: string) {
  const seconds = Math.max(0, Math.floor((Date.parse(expiry) - Date.now()) / 1000));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${refreshCookieName}=${token}; Path=/api/customer-auth; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}
function bothCookies(request: Request, bearer: string, seconds: number, refresh: { refreshToken: string; refreshExpiresAt: string } | null) {
  const headers = new Headers(noStore);
  headers.append("Set-Cookie", cookieFor(request, bearer, seconds));
  if (refresh) headers.append("Set-Cookie", refreshCookieFor(request, refresh.refreshToken, refresh.refreshExpiresAt));
  else headers.append("Set-Cookie", refreshCookieFor(request, "", new Date(0).toISOString()));
  return headers;
}
async function resumeWithRefresh(request: Request, origin: string): Promise<Response> {
  const refresh = refreshFrom(request);
  if (!refresh) return Response.json({ enabled: true, session: null },
    { headers: bothCookies(request, "", 0, null) });
  try {
    const rotated = await rotatePersistentIdentitySession(origin, refresh, AbortSignal.timeout(5000));
    const renewed = await readVerifiedIdentitySession(origin, rotated.accessToken, AbortSignal.timeout(5000));
    if (renewed.role !== "customer") throw new IdentityClientError(403, "FORBIDDEN");
    const remaining = Math.max(0, Math.floor((Date.parse(renewed.sessionExpiresAt) - Date.now()) / 1000));
    return Response.json({ enabled: true, session: renewed },
      { headers: bothCookies(request, rotated.accessToken, remaining, rotated) });
  } catch (error) {
    if (!(error instanceof IdentityClientError && [401,403].includes(error.status))) return ownerFailure(error);
    return Response.json({ enabled: true, session: null },
      { headers: bothCookies(request, "", 0, null) });
  }
}

function isSameOrigin(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function ownerFailure(error: unknown) {
  if (error instanceof IdentityClientError && error.status >= 400 && error.status < 500) {
    return json({ code: error.code }, error.status);
  }
  return json({ code: "OWNER_UNAVAILABLE" }, 503);
}

async function boundedRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(2000)]);
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<null>(resolve => {
    onAbort = () => resolve(null);
    if (readSignal.aborted) resolve(null);
    else readSignal.addEventListener("abort", onAbort, { once: true });
  });
  const bytes = new Uint8Array(256);
  let size = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next === null) return null;
      const { done, value } = next;
      if (done) break;
      if (size + value.length > bytes.length) return null;
      bytes.set(value, size);
      size += value.length;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    if (onAbort) readSignal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function revokeFailedProof(origin: string, bearer: string) {
  await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(2000)).catch(() => undefined);
}

export async function GET(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ enabled: false, session: null });
  if (new URL(request.url).search) return json({ code: "INVALID_REQUEST" }, 400);
  const bearer = bearerFor(request);
  if (!bearer) return resumeWithRefresh(request, origin);
  try {
    const session = await readVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    if (session.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
    return json({ enabled: true, session });
  } catch (error) {
    if (error instanceof IdentityClientError && error.status === 401) {
      const refresh = refreshFrom(request);
      if (refresh) {
        try {
          const rotated = await rotatePersistentIdentitySession(origin, refresh, AbortSignal.timeout(5000));
          const renewed = await readVerifiedIdentitySession(origin, rotated.accessToken, AbortSignal.timeout(5000));
          if (renewed.role !== "customer") throw new IdentityClientError(403, "FORBIDDEN");
          const remaining = Math.max(0, Math.floor((Date.parse(renewed.sessionExpiresAt)-Date.now())/1000));
          return Response.json({ enabled: true, session: renewed }, { headers: bothCookies(request, rotated.accessToken, remaining, rotated) });
        } catch (failure) {
          if (!(failure instanceof IdentityClientError && failure.status === 401)) return ownerFailure(failure);
        }
      }
      return Response.json({ enabled: true, session: null }, { headers: bothCookies(request, "", 0, null) });
    }
    if (error instanceof IdentityClientError && error.status === 403) {
      return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
    }
    return ownerFailure(error);
  }
}

export async function POST(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isSameOrigin(request)) return json({ code: "FORBIDDEN" }, 403);
  const body = await boundedRequestBody(request);
  if (!body) return json({ code: "INVALID_REQUEST" }, 400);
  try {
    const signal = AbortSignal.timeout(15000);
    if (Object.keys(body).length === 1 && typeof body.phone === "string") {
      const ticket = await issueCustomerPhoneChallenge(origin, body.phone, signal);
      return json({ ticket }, 201);
    }
    if (Object.keys(body).length !== 2 || typeof body.ticket !== "string" || typeof body.code !== "string") {
      return json({ code: "INVALID_REQUEST" }, 400);
    }
    // A live or recoverable family must be explicitly revoked before changing accounts.
    if (refreshFrom(request)) return json({ code: "SIGN_OUT_REQUIRED" }, 409);
    const existing = bearerFor(request);
    if (existing) {
      try {
        const active = await readVerifiedIdentitySession(origin, existing, signal);
        if (active.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
        return json({ code: "SIGN_OUT_REQUIRED" }, 409);
      } catch (error) {
        if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
      }
    }
    const issued = await verifyCustomerPhoneChallenge(origin, body.ticket, body.code, signal);
    let verified: VerifiedIdentitySession;
    try {
      verified = await readVerifiedIdentitySession(origin, issued.accessToken, signal);
      if (verified.role !== "customer" || signal.aborted) {
        throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
      }
      const persistent = await establishPersistentIdentitySession(origin, issued.accessToken, signal);
      const remaining = Math.max(0, Math.floor((Date.parse(verified.sessionExpiresAt) - Date.now()) / 1000));
      if (signal.aborted || remaining <= 0) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      return Response.json({ session: verified }, { headers: bothCookies(request, issued.accessToken, remaining, persistent) });
    } catch (error) {
      await revokeFailedProof(origin, issued.accessToken);
      throw error;
    }
  } catch (error) {
    return ownerFailure(error);
  }
}

export async function DELETE(request: Request) {
  const origin = configuredOwner(request);
  if (!origin) return json({ code: "OWNER_UNAVAILABLE" }, 503);
  if (!isSameOrigin(request)) return json({ code: "FORBIDDEN" }, 403);
  const bearer = bearerFor(request);
  const refresh = refreshFrom(request);
  if (refresh) {
    try { await revokePersistentIdentitySession(origin, refresh, AbortSignal.timeout(5000)); }
    catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) return ownerFailure(error);
    }
  }
  if (bearer) {
    try {
      const verified = await readVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
      if (verified.role !== "customer") return json({ code: "FORBIDDEN" }, 403, cookieFor(request, "", 0));
      await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(5000));
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
        return ownerFailure(error);
      }
    }
  }
  return new Response(null, { status: 204, headers: bothCookies(request, "", 0, null) });
}
