import { readVerifiedIdentitySession, rotatePersistentIdentitySession } from "@bthwani/identity";
import { OPERATOR_COOKIE, OPERATOR_REFRESH_COOKIE, cookieLifetimeSeconds,
  resolveIsolatedOperatorConfig } from "./src/server/operator-passkey-bff";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server.js";

// The Operator host is request-rendered: its CSP nonce must never be reused in cached HTML.
// Authorization is enforced by Identity/owner APIs, not by this presentation-layer Proxy.
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Ant Design's SSR registry and current Stage-4 JSX style attributes still need inline CSS.
    // Do not relax script-src for this compatibility boundary.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${development ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Overwrite untrusted client headers with the actual matched route.
  requestHeaders.set("x-bthwani-route", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", policy);
  // A normal top-level navigation is the safe single-request point to renew
  // an expired browser access cookie before Server Components read it.
  // Non-navigation API mutations are never silently replayed or authorized here.
  let rotated: Awaited<ReturnType<typeof rotatePersistentIdentitySession>> | null = null;
  const config = resolveIsolatedOperatorConfig(process.env);
  const refresh = request.cookies.get(OPERATOR_REFRESH_COOKIE)?.value;
  if (config && request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate" &&
      request.nextUrl.origin === config.browserOrigin &&
      !request.cookies.get(OPERATOR_COOKIE)?.value &&
      refresh && /^[A-Za-z0-9_-]{43}$/.test(refresh)) {
    try {
      const next = await rotatePersistentIdentitySession(config.identityOrigin,refresh,AbortSignal.timeout(4500));
      const principal = await readVerifiedIdentitySession(config.identityOrigin,next.accessToken,AbortSignal.timeout(4500));
      if (principal.role === "operator") {
        const others = request.headers.get("cookie")?.split(";").map(value=>value.trim()).filter(value=>
          !value.startsWith(OPERATOR_COOKIE+"=") && !value.startsWith(OPERATOR_REFRESH_COOKIE+"=")) ?? [];
        requestHeaders.set("cookie",[...others,OPERATOR_COOKIE+"="+next.accessToken,
          OPERATOR_REFRESH_COOKIE+"="+next.refreshToken].join("; "));
        rotated = next;
      }
    } catch { /* Owner outage or denial never manufactures a session. */ }
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (rotated) {
    response.cookies.set(OPERATOR_COOKIE,rotated.accessToken,{
      path:"/",httpOnly:true,secure:false,sameSite:"strict",
      maxAge:cookieLifetimeSeconds(rotated.sessionExpiresAt),
    });
    response.cookies.set(OPERATOR_REFRESH_COOKIE,rotated.refreshToken,{
      path:"/",httpOnly:true,secure:false,sameSite:"strict",
      maxAge:Math.max(0,Math.floor((Date.parse(rotated.refreshExpiresAt)-Date.now())/1000)),
    });
  }
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
