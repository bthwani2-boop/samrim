// Merchant browser admission owns its HTTP boundary; Identity and DSH own business state.
import { DshPublicError } from "@bthwani/dsh";
import { IdentityClientError } from "@bthwani/identity";
import { MerchantStandingError } from "./dsh-standing.ts";

export const cookieName = "bthwani_merchant_admission";
export const refreshCookieName = `${cookieName}.refresh`;
const localIdentity = "http://127.0.0.1:3201";
const localDSH = "http://127.0.0.1:3202";

export const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function configuredOrigin(request: Request) {
  const { hostname } = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(hostname)) return undefined;
  const configured = process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  if (configured || process.env.NODE_ENV !== "development") return configured;
  try {
    // A read-only 405/POST readiness response proves the isolated entry is enabled.
    const readiness = await fetch(localIdentity + "/v1/customer-auth/phone-challenges", {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (readiness.body) void readiness.body.cancel().catch(() => {});
    if (readiness.status === 405 && readiness.headers.get("Allow") === "POST") return localIdentity;
  } catch {
    // Owner unavailable: do not admit a local origin.
  }
}

export function standingOrigin(identity: string) {
  return process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN ??
    (process.env.NODE_ENV === "development" && identity === localIdentity ? localDSH : "");
}

export function response(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers(noStoreHeaders);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}

function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map(entry => entry.trim())
    .find(entry => entry.startsWith(name + "="))?.slice(name.length + 1);
}

function admissionCookie(request: Request, name: string, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function remainingSeconds(expiry: string) {
  return Math.max(0, Math.floor((Date.parse(expiry) - Date.now()) / 1000));
}

export function sessionCookie(request: Request, bearer: string, maxAge: number) {
  return admissionCookie(request, cookieName, bearer, maxAge);
}

export function bearerFrom(request: Request) {
  return cookieValue(request, cookieName);
}

export function refreshFrom(request: Request) {
  const token = cookieValue(request, refreshCookieName);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function appendSessionCookies(
  result: Response,
  request: Request,
  access: string,
  accessExpiry: string,
  refresh: { refreshToken: string; refreshExpiresAt: string } | null,
) {
  result.headers.append("Set-Cookie", sessionCookie(request, access, remainingSeconds(accessExpiry)));
  result.headers.append("Set-Cookie", admissionCookie(
    request, refreshCookieName, refresh?.refreshToken ?? "",
    refresh ? remainingSeconds(refresh.refreshExpiresAt) : 0,
  ));
  return result;
}

export function isLocalMutation(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

export function ownerError(error: unknown) {
  if (error instanceof DshPublicError && error.code === "OPERATION_RESULT_UNKNOWN") {
    return response({ code: error.code }, 503);
  }
  if ((error instanceof IdentityClientError || error instanceof MerchantStandingError || error instanceof DshPublicError) &&
    error.status >= 400 && error.status < 500) {
    return response({ code: error.code }, error.status);
  }
  return response({ code: "OWNER_UNAVAILABLE" }, 503);
}

export async function readMutationBody(request: Request, limit: number): Promise<unknown> {
  const { body, headers, signal } = request;
  if (!body || body.locked) return null;
  const declared = headers.get("Content-Length");
  if (
    signal.aborted ||
    headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
  ) {
    void body.cancel().catch(() => {});
    return null;
  }

  const reader = body.getReader();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
  let interrupt!: () => void;
  let consumed = false;
  const stopped = new Promise<null>(resolve => { interrupt = () => resolve(null); });
  deadline.addEventListener("abort", interrupt, { once: true });

  async function consume(): Promise<unknown> {
    const bytes = new Uint8Array(limit);
    let used = 0;
    for (;;) {
      const chunk = await reader.read();
      if (deadline.aborted) return null;
      if (chunk.done) {
        consumed = true;
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
      }
      if (chunk.value.byteLength > bytes.length - used) return null;
      bytes.set(chunk.value, used);
      used += chunk.value.byteLength;
    }
  }

  try {
    const value = await Promise.race([consume(), stopped]);
    return deadline.aborted ? null : value;
  } catch {
    return null;
  } finally {
    deadline.removeEventListener("abort", interrupt);
    if (!consumed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
