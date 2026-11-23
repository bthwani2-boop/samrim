// HTTP utilities used only by the Merchant admission API route and its handlers.
import { DshPublicError } from "@bthwani/dsh";
import { IdentityClientError } from "@bthwani/identity";
import { MerchantStandingError } from "./dsh-standing.ts";

export const cookieName = process.env.BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani_surface_merchant_admission" : "bthwani_merchant_admission";
const localIdentity = "http://127.0.0.1:3201";
const localDSH = "http://127.0.0.1:3202";
export const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function configuredOrigin(request: Request) {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return undefined;
  const configured = process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  if (configured || process.env.NODE_ENV !== "development") return configured;
  try {
    // The isolated phone handler returns 405 for a GET only while enabled.
    // This is a read-only readiness check, independent of Metro startup.
    const readiness = await fetch(localIdentity + "/v1/customer-auth/phone-challenges", {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    await readiness.body?.cancel();
    if (readiness.status === 405 && readiness.headers.get("Allow") === "POST") return localIdentity;
  } catch {
    // Keep local admission unavailable until the owner responds.
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

export function sessionCookie(request: Request, bearer: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${bearer}; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export const refreshCookieName = `${cookieName}.refresh`;
export function refreshFrom(request: Request) {
  const result = request.headers.get("cookie")?.split(";").map(entry => entry.trim())
    .find(entry => entry.startsWith(refreshCookieName + "="))?.slice(refreshCookieName.length + 1);
  return result && /^[A-Za-z0-9_-]{43}$/.test(result) ? result : null;
}
function refreshCookie(request: Request, token: string, expiry: string) {
  const seconds = Math.max(0, Math.floor((Date.parse(expiry)-Date.now()) / 1000));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${refreshCookieName}=${token}; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}
export function appendSessionCookies(result: Response, request: Request,
    access: string, accessExpiry: string, refresh: {refreshToken:string;refreshExpiresAt:string} | null) {
  result.headers.append("Set-Cookie", sessionCookie(request, access,
    Math.max(0,Math.floor((Date.parse(accessExpiry)-Date.now())/1000))));
  if (refresh) result.headers.append("Set-Cookie",refreshCookie(request,refresh.refreshToken,refresh.refreshExpiresAt));
  else if (!access) result.headers.append("Set-Cookie",refreshCookie(request,"",new Date(0).toISOString()));
  return result;
}
export function bearerFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map(entry => entry.trim())
    .find(entry => entry.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
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
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length + length > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } catch {
    return null;
  }
}
