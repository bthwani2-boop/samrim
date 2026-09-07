import { NextResponse, type NextRequest } from "next/server";
import { verifySameOrigin } from "./lib/csrf";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function contentSecurityPolicy(): string {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return `${csp.join("; ")};`;
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function proxy(request: NextRequest) {
  const csp = contentSecurityPolicy();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", csp.match(/'nonce-([^']+)'/)?.[1] ?? "");

  if (request.nextUrl.pathname.startsWith("/api/") && UNSAFE_METHODS.has(request.method.toUpperCase()) && !verifySameOrigin(request)) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "FORBIDDEN_CROSS_ORIGIN", message: "Cross-origin requests are forbidden for control-panel mutations" },
        { status: 403 },
      ),
      csp,
    );
  }

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
  );
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
