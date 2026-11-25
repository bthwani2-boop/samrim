import { identityOperations, IdentityClientError, readVerifiedIdentitySession,
  reviewOriginalOperatorPermissions, rotatePersistentIdentitySession, revokePersistentIdentitySession } from "@bthwani/identity";
import { type NextRequest, NextResponse } from "next/server";
import {
  cookieLifetimeSeconds,
  isEmptyRequestBody,
  isTrustedOperatorLoopbackTarget,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  OPERATOR_REFRESH_COOKIE,
  type OperatorPasskeyConfig,
  operatorIdentityRequest,
  readOperatorAccessState,
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

async function originalAuthority(config: OperatorPasskeyConfig, bearer: string, actorId: string): Promise<boolean | null> {
  try {
    await reviewOriginalOperatorPermissions(config.identityOrigin, bearer, actorId, AbortSignal.timeout(4000));
    return true;
  } catch (error) {
    if (error instanceof IdentityClientError && [403, 404].includes(error.status)) return false;
    return null;
  }
}

async function restoredOperatorSession(request: NextRequest, config: OperatorPasskeyConfig, expectedActorId?: string): Promise<NextResponse> {
  const refresh = request.cookies.get(OPERATOR_REFRESH_COOKIE)?.value;
  if (!refresh || !/^[A-Za-z0-9_-]{43}$/.test(refresh)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  }
  try {
    const rotated = await rotatePersistentIdentitySession(config.identityOrigin,refresh,AbortSignal.timeout(5000));
    const session = await readVerifiedIdentitySession(config.identityOrigin,rotated.accessToken,AbortSignal.timeout(5000));
    if (session.role !== "operator" || (expectedActorId && session.actorId !== expectedActorId)) {
      throw new IdentityClientError(403,"FORBIDDEN");
    }
    const state = await readOperatorAccessState(config, rotated.accessToken);
    if (state.status === "signed-out" || (state.status === "verified" && state.access.actorId !== session.actorId)) {
      throw new IdentityClientError(403,"FORBIDDEN");
    }
    // A confirmed role may retain its new credentials during a permission-owner
    // outage, but the browser receives no authorized workspace state.
    const originalOperator = state.status === "verified"
      ? await originalAuthority(config, rotated.accessToken, session.actorId) : null;
    const response = state.status === "verified" && originalOperator !== null
      ? NextResponse.json({authenticated:true,role:"operator",...state.access,originalOperator},{status:200,headers:privateHeaders})
      : NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
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
    const state = await readOperatorAccessState(config, accessToken);
    if (state.status === "signed-out") return restoredOperatorSession(request, config);
    if (state.status !== "verified") {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const refresh = request.cookies.get(OPERATOR_REFRESH_COOKIE)?.value;
    // Renew before access expiry. The browser holds the origin-wide session
    // lock for the complete cookie-writing request.
    if (cookieLifetimeSeconds(state.access.sessionExpiresAt) <= 90 &&
        refresh && /^[A-Za-z0-9_-]{43}$/.test(refresh)) {
      return restoredOperatorSession(request, config, state.access.actorId);
    }
    const originalOperator = await originalAuthority(config, accessToken, state.access.actorId);
    if (originalOperator === null) return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    return NextResponse.json({
      authenticated: true, role: "operator", ...state.access, originalOperator,
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
