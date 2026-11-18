import { NextResponse } from "next/server";
import {
  boundedRequestBody,
  boundedResponseJSON,
  cookieLifetimeSeconds,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  operatorIdentityRequest,
  parseIssuedOperatorToken,
  parseVerifiedOperatorPrincipal,
  resolveIsolatedOperatorConfig,
  validAssertion,
} from "../../../../../src/server/operator-passkey-bff";
import { unavailableSessionResponse } from "../../../../../src/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request: Request) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request, config) ||
      request.headers.get("content-type")?.toLowerCase() !== "application/json") {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  const raw = await boundedRequestBody(request);
  if (raw === null) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  if (!validAssertion(input)) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  try {
    const auth = await operatorIdentityRequest(
      config,
      "/v1/operators/passkey/authentication",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: raw },
    );
    if (auth.status === 401) {
      return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
    }
    if (auth.status !== 200) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const issued = parseIssuedOperatorToken(await boundedResponseJSON(auth));
    if (!issued) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const owner = await operatorIdentityRequest(
      config,
      "/v1/sessions/current",
      { method: "GET", headers: { Authorization: `Bearer ${issued.accessToken}` } },
    );
    if (owner.status !== 200 ||
        !parseVerifiedOperatorPrincipal(await boundedResponseJSON(owner), issued)) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const response = NextResponse.json({ authenticated: true }, { status: 200, headers: privateHeaders });
    response.cookies.set(OPERATOR_COOKIE, issued.accessToken, {
      path: "/",
      httpOnly: true,
      secure: false, // Only isolated loopback HTTP is permitted by resolveIsolatedOperatorConfig
      sameSite: "strict",
      maxAge: cookieLifetimeSeconds(issued.sessionExpiresAt),
    });
    return response;
  } catch {
    return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
  }
}
