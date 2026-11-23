import { identityOperations, IdentityClientError, readVerifiedIdentitySession,
  rotatePersistentIdentitySession, revokePersistentIdentitySession } from "@bthwani/identity";
import { type NextRequest, NextResponse } from "next/server";
import {
  boundedResponseJSON,
  cookieLifetimeSeconds,
  isEmptyRequestBody,
  isTrustedOperatorLoopbackTarget,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  OPERATOR_REFRESH_COOKIE,
  type OperatorPasskeyConfig,
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

function clearOperatorCookie(response: NextResponse) {
  response.cookies.set(OPERATOR_REFRESH_COOKIE, "", {
    path: "/", httpOnly: true, secure: false, sameSite: "strict", maxAge: 0,
  });
  response.cookies.set(OPERATOR_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: false, // This endpoint is enabled only for isolated loopback HTTP.
    sameSite: "strict",
    maxAge: 0,
  });
}

async function restoredOperatorSession(request: NextRequest, config: OperatorPasskeyConfig): Promise<NextResponse> {
  const refresh = request.cookies.get(OPERATOR_REFRESH_COOKIE)?.value;
  if (!refresh || !/^[A-Za-z0-9_-]{43}$/.test(refresh)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  }
  try {
    const rotated = await rotatePersistentIdentitySession(config.identityOrigin,refresh,AbortSignal.timeout(5000));
    const session = await readVerifiedIdentitySession(config.identityOrigin,rotated.accessToken,AbortSignal.timeout(5000));
    if (session.role !== "operator") throw new IdentityClientError(403,"FORBIDDEN");
    const response = NextResponse.json({authenticated:true,actorId:session.actorId,role:session.role,
      sessionExpiresAt:session.sessionExpiresAt},{status:200,headers:privateHeaders});
    response.cookies.set(OPERATOR_COOKIE,rotated.accessToken,{
      path:"/",httpOnly:true,secure:false,sameSite:"strict",
      maxAge:cookieLifetimeSeconds(rotated.sessionExpiresAt),
    });
    response.cookies.set(OPERATOR_REFRESH_COOKIE,rotated.refreshToken,{
      path:"/",httpOnly:true,secure:false,sameSite:"strict",
      maxAge:Math.max(0,Math.floor((Date.parse(rotated.refreshExpiresAt)-Date.now())/1000)),
    });
    return response;
  } catch(error) {
    if (error instanceof IdentityClientError && [401,403].includes(error.status)) {
      const response=NextResponse.json({code:"UNAUTHORIZED"},{status:401,headers:privateHeaders});
      clearOperatorCookie(response);
      return response;
    }
    return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
  }
}

export async function GET(request: NextRequest) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorLoopbackTarget(request, config.browserOrigin)) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  const accessToken = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (!accessToken || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
    return restoredOperatorSession(request,config);
  }
  try {
    const upstream = await operatorIdentityRequest(
      config,
      identityOperations.getVerifiedIdentitySession,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (upstream.status === 401 || upstream.status === 403) {
      return restoredOperatorSession(request,config);
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
  if (!isTrustedOperatorRequest(request, config) || !(await isEmptyRequestBody(request))) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  const accessToken = request.cookies.get(OPERATOR_COOKIE)?.value;
  const response = new NextResponse(null, { status: 204, headers: privateHeaders });
  clearOperatorCookie(response);
  const refresh = request.cookies.get(OPERATOR_REFRESH_COOKIE)?.value;
  if (refresh && /^[A-Za-z0-9_-]{43}$/.test(refresh)) {
    try { await revokePersistentIdentitySession(config.identityOrigin,refresh,AbortSignal.timeout(5000)); }
    catch(error) {
      if (!(error instanceof IdentityClientError && error.status===401)) {
        return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
      }
    }
  }
  if (!accessToken || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) return response;
  try {
    const upstream = await operatorIdentityRequest(
      config,
      identityOperations.revokeCurrentIdentitySession,
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
