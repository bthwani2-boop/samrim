import {
  changeOperatorStoreRegistrationPolicy, DshPublicError,getOperatorStoreRegistrationPolicy,
  listOperatorStoreRegistrationPolicyHistory,
  type OperatorStoreRegistrationChange,
  validOperatorStoreRegistrationChange,
} from "@bthwani/dsh";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { currentOperatorAccess } from "../../../../../../../src/server/current-operator-access";
import { isTrustedOperatorLoopbackTarget, OPERATOR_COOKIE, resolveIsolatedOperatorConfig } from "../../../../../../../src/server/operator-passkey-config";
import { boundedRequestBody } from "../../../../../../../src/server/operator-passkey-transport";
import { unavailableSessionResponse } from "../../../../../../../src/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = Readonly<{ params: Promise<{ cityid: string; relation: string }> }>;
const cityRule = /^[a-z0-9-]{1,64}$/;
const historyQuery = /^\?history=1(?:&limit=([1-9]|[1-4][0-9]|50))?(?:&beforeVersion=([1-9][0-9]{0,18}))?$/;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const replyError = (code: string, status: number) =>
  NextResponse.json({ code }, { status, headers: privateHeaders });

function isolatedDshOrigin(raw: string | undefined): string | null {
  if (!raw?.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.port ||
      url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || raw !== url.origin) return null;
    return raw;
  } catch { return null; }
}
function trustedRequest(request: NextRequest, browserOrigin: string, mutation: boolean) {
  const url = new URL(request.url);
  const queryOK = url.search === "" || (!mutation && historyQuery.test(url.search));
  return queryOK &&
    request.method === (mutation ? "PATCH" : "GET") &&
    (!mutation || request.headers.get("origin") === browserOrigin) &&
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    isTrustedOperatorLoopbackTarget(request, browserOrigin, !mutation);
}
async function boundedChange(request: NextRequest): Promise<OperatorStoreRegistrationChange | null> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return null;
  }
  // Up to 4,000 Unicode terms characters plus bounded command metadata.
  const raw = await boundedRequestBody(request, 24576);
  if (!raw || Buffer.byteLength(raw, "utf8") > 24576) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return validOperatorStoreRegistrationChange(data) ? data : null;
  } catch { return null; }
}

async function forward(request: NextRequest, context: Context, mutation: boolean): Promise<NextResponse> {
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  const dshOrigin = isolatedDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!dshOrigin) return replyError("DSH_OWNER_UNAVAILABLE", 503);
  const { cityid, relation } = await context.params;
  if (!cityRule.test(cityid) || !["MARKETPLACE", "DIRECT"].includes(relation) ||
    !trustedRequest(request, config.browserOrigin, mutation)) {
    return replyError("INVALID_REQUEST", 400);
  }
  const access = await currentOperatorAccess();
  if (!access) return replyError("UNAUTHORIZED", 401);
  if (!access.grants.includes("platform_policies") ||
    request.headers.get("X-BThwani-Operator") !== encodeURIComponent(access.actorId)) {
    return replyError("FORBIDDEN", 403);
  }
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return replyError("UNAUTHORIZED", 401);
  const historyMatch = !mutation && new URL(request.url).search ?
    historyQuery.exec(new URL(request.url).search) : null;
  const change = mutation ? await boundedChange(request) : null;
  if (mutation && !change) return replyError("INVALID_REQUEST", 400);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    const result = historyMatch
      ? await listOperatorStoreRegistrationPolicyHistory(dshOrigin, cityid,
          relation as "MARKETPLACE" | "DIRECT", bearer,
          historyMatch[1] ? Number(historyMatch[1]) : 20, historyMatch[2], signal)
      : change
        ? await changeOperatorStoreRegistrationPolicy(dshOrigin, cityid, relation as "MARKETPLACE" | "DIRECT", bearer, change, signal)
        : await getOperatorStoreRegistrationPolicy(dshOrigin, cityid, relation as "MARKETPLACE" | "DIRECT", bearer, signal);
    if (change && result && "policy" in result && result.policy.changedByActor !== access.actorId) {
      return replyError("DSH_OWNER_UNAVAILABLE", 503);
    }
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof DshPublicError) {
      if (error.status === 400) return replyError("INVALID_REQUEST", 400);
      if (error.status === 401) return replyError("UNAUTHORIZED", 401);
      if (error.status === 403) return replyError("FORBIDDEN", 403);
      if (error.status === 409) return replyError("VERSION_CONFLICT", 409);
    }
    return replyError(mutation ? "OPERATION_RESULT_UNKNOWN" : "DSH_OWNER_UNAVAILABLE", 503);
  }
}
export async function GET(request: NextRequest, context: Context) { return forward(request, context, false); }
export async function PATCH(request: NextRequest, context: Context) { return forward(request, context, true); }
