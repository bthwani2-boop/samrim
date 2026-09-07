import { NextResponse, type NextRequest } from "next/server";
import { verifySameOrigin } from "./lib/csrf";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function createContentSecurityPolicy(): Readonly<{ nonce: string; value: string }> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const value = [
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
  return { nonce, value: `${value.join("; ")};` };
}

export function proxy(request: NextRequest) {
  const { nonce, value: csp } = createContentSecurityPolicy();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (request.nextUrl.pathname.startsWith("/api/") && UNSAFE_METHODS.has(request.method.toUpperCase()) && !verifySameOrigin(request)) {
    const response = NextResponse.json(
      { error: "FORBIDDEN_CROSS_ORIGIN", message: "Cross-origin requests are forbidden for control-panel mutations" },
      { status: 403 },
    );
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
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
