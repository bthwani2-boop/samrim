import {
  IdentityClientError,
  identityOperations,
  readVerifiedIdentitySession,
  reviewOriginalOperatorPermissions,
  revokePersistentIdentitySession,
  rotatePersistentIdentitySession,
} from "@bthwani/identity";
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

// This endpoint is enabled only for isolated loopback HTTP.
const cookieOptions = { path: "/", httpOnly: true, secure: false, sameSite: "strict" as const };
type Rotation = Awaited<ReturnType<typeof rotatePersistentIdentitySession>>;
type Access = Extract<Awaited<ReturnType<typeof readOperatorAccessState>>, {status: "verified"}>["access"];

function credential(request: NextRequest, name: string): string | undefined {
  const value = request.cookies.get(name)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

function rejected(status: 400 | 401 | 503, clear = false): NextResponse {
  const code = status === 400 ? "INVALID_REQUEST" : status === 401 ? "UNAUTHORIZED" : "OWNER_UNAVAILABLE";
  const response = NextResponse.json({code}, {status, headers: privateHeaders});
  if (clear) clearCookies(response);
  return response;
}

function clearCookies(response: NextResponse): void {
  for (const name of [OPERATOR_COOKIE, OPERATOR_REFRESH_COOKIE]) {
    response.cookies.set(name, "", {...cookieOptions, maxAge: 0});
  }
}

function retainRotation(response: NextResponse, rotation: Rotation): NextResponse {
  response.cookies.set(OPERATOR_COOKIE, rotation.accessToken, {
    ...cookieOptions, maxAge: cookieLifetimeSeconds(rotation.sessionExpiresAt),
  });
  response.cookies.set(OPERATOR_REFRESH_COOKIE, rotation.refreshToken, {
    ...cookieOptions, maxAge: Math.max(0, Math.floor((Date.parse(rotation.refreshExpiresAt) - Date.now()) / 1000)),
  });
  return response;
}

function denied(error: unknown): boolean {
  return error instanceof IdentityClientError && [401, 403].includes(error.status);
}

async function originalAuthority(config: OperatorPasskeyConfig, bearer: string, actorId: string): Promise<boolean | null> {
  try {
    await reviewOriginalOperatorPermissions(config.identityOrigin, bearer, actorId, AbortSignal.timeout(4000));
    return true;
  } catch (error) {
    return error instanceof IdentityClientError && [403, 404].includes(error.status) ? false : null;
  }
}

async function admitted(config: OperatorPasskeyConfig, bearer: string, access: Access): Promise<NextResponse> {
  const originalOperator = await originalAuthority(config, bearer, access.actorId);
  return originalOperator === null ? rejected(503) : NextResponse.json({
    authenticated: true, role: "operator", ...access, originalOperator,
  }, {status: 200, headers: privateHeaders});
}

// Identity alone revokes a family. An unavailable owner does not confirm
// revocation, but an unadmitted rotated credential must never reach cookies.
async function revokeFamily(config: OperatorPasskeyConfig, refresh: string): Promise<boolean> {
  try {
    await revokePersistentIdentitySession(config.identityOrigin, refresh, AbortSignal.timeout(5000));
    return true;
  } catch (error) {
    return error instanceof IdentityClientError && error.status === 401;
  }
}

async function restore(request: NextRequest, config: OperatorPasskeyConfig, expectedActorId?: string): Promise<NextResponse> {
  const refresh = credential(request, OPERATOR_REFRESH_COOKIE);
  if (!refresh) return rejected(401);

  let rotation: Rotation;
  try {
    rotation = await rotatePersistentIdentitySession(config.identityOrigin, refresh, AbortSignal.timeout(5000));
  } catch (error) {
    // A pre-receipt owner outage may be recoverable; don't discard the only
    // retained credential merely because the owner cannot confirm rotation.
    return denied(error) ? rejected(401, true) : rejected(503);
  }

  try {
    const session = await readVerifiedIdentitySession(config.identityOrigin, rotation.accessToken, AbortSignal.timeout(5000));
    if (session.role !== "operator" || (expectedActorId && session.actorId !== expectedActorId)) {
      throw new IdentityClientError(403, "FORBIDDEN");
    }
    const state = await readOperatorAccessState(config, rotation.accessToken);
    if (state.status === "signed-out" || (state.status === "verified" && state.access.actorId !== session.actorId)) {
      throw new IdentityClientError(403, "FORBIDDEN");
    }
    // Only a verified principal can retain rotated credentials during a grant
    // owner outage. No workspace state is admitted until all reads succeed.
    const response = state.status === "verified"
      ? await admitted(config, rotation.accessToken, state.access) : rejected(503);
    return retainRotation(response, rotation);
  } catch (error) {
    // Rotation already consumed the previous refresh. Retire both browser
    // cookies and attempt cleanup of the actual received family, even when
    // verification or cleanup cannot be confirmed.
    await revokeFamily(config, rotation.refreshToken);
    return rejected(denied(error) ? 401 : 503, true);
  }
}

export async function GET(request: NextRequest) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorLoopbackTarget(request, config.browserOrigin)) return rejected(400);

  const bearer = credential(request, OPERATOR_COOKIE);
  if (!bearer) return restore(request, config);
  try {
    const state = await readOperatorAccessState(config, bearer);
    if (state.status === "signed-out") return restore(request, config);
    if (state.status !== "verified") return rejected(503);
    if (cookieLifetimeSeconds(state.access.sessionExpiresAt) <= 90 && credential(request, OPERATOR_REFRESH_COOKIE)) {
      return restore(request, config, state.access.actorId);
    }
    return admitted(config, bearer, state.access);
  } catch {
    return rejected(503);
  }
}

export async function POST(request: NextRequest) {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request, config) || !(await isEmptyRequestBody(request))) return rejected(400);

  // Keep the existing retry boundary: when the refresh owner cannot confirm
  // revocation, retain the browser credentials and do not report logout.
  const refresh = credential(request, OPERATOR_REFRESH_COOKIE);
  if (refresh && !await revokeFamily(config, refresh)) return rejected(503);

  const bearer = credential(request, OPERATOR_COOKIE);
  if (bearer) {
    try {
      const upstream = await operatorIdentityRequest(config, identityOperations.revokeCurrentIdentitySession, {
        headers: {Authorization: "Bearer " + bearer},
      });
      if (![204, 401].includes(upstream.status)) return rejected(503, true);
    } catch {
      return rejected(503, true);
    }
  }
  const response = new NextResponse(null, {status: 204, headers: privateHeaders});
  clearCookies(response);
  return response;
}
