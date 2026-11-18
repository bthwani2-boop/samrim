import { type NextRequest, NextResponse } from "next/server";
import {
  boundedResponseJSON,
  cookieLifetimeSeconds,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  operatorIdentityRequest,
  parseVerifiedOperatorPrincipal,
  resolveIsolatedOperatorConfig,
} from "../../../../src/server/operator-passkey-bff";
import { unavailableSessionResponse } from "../../../../src/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function validLoopbackRead(request: NextRequest, expectedOrigin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== expectedOrigin || url.search ||
      request.headers.get("host") !== url.host) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== url.host) return false;
  for (const claim of ["authorization", "x-actor-id", "x-operator-role", "x-role"]) {
    if (request.headers.has(claim)) return false;
  }
  return true;
}

function clearOperatorCookie(response: NextResponse) {
  response.cookies.set(OPERATOR_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: false, // This endpoint is enabled only for isolated loopback HTTP.
    sameSite: "strict",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!validLoopbackRead(request, config.browserOrigin)) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  const accessToken = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (!accessToken || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  }
  try {
    const upstream = await operatorIdentityRequest(
      config,
      "/v1/sessions/current",
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (upstream.status === 401 || upstream.status === 403) {
      const response = NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
      clearOperatorCookie(response);
      return response;
    }
    if (upstream.status !== 200) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const principalValue = await boundedResponseJSON(upstream);
    if (!principalValue || typeof principalValue !== "object" || Array.isArray(principalValue)) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const expiry = (principalValue as Record<string, unknown>).sessionExpiresAt;
    if (typeof expiry !== "string") {
      return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
    }
    const principal = parseVerifiedOperatorPrincipal(
      principalValue,
      { accessToken, sessionExpiresAt: expiry },
    );
    if (!principal || cookieLifetimeSeconds(principal.sessionExpiresAt) <= 0) {
      const response = NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
      clearOperatorCookie(response);
      return response;
    }
    return NextResponse.json({
      authenticated: true,
      actorId: principal.actorId,
      role: principal.role,
      sessionExpiresAt: principal.sessionExpiresAt,
    }, { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
  }
}

export async function POST(request: NextRequest) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request, config) || request.body !== null) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  const accessToken = request.cookies.get(OPERATOR_COOKIE)?.value;
  const response = new NextResponse(null, { status: 204, headers: privateHeaders });
  clearOperatorCookie(response);
  if (!accessToken || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return response;
  try {
    const upstream = await operatorIdentityRequest(
      config,
      "/v1/sessions/current",
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if ([204, 401].includes(upstream.status)) return response;
    const unavailable = NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    clearOperatorCookie(unavailable);
    return unavailable;
  } catch {
    const unavailable = NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    clearOperatorCookie(unavailable);
    return unavailable;
  }
}
