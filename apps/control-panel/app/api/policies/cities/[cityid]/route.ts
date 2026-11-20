import {
  type CityStoreOperationalPolicyChange, DshPublicError, getCityStoreOperationalPolicy,
  replaceCityStoreOperationalPolicy,
} from "@bthwani/dsh";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { currentOperatorAccess } from "../../../../../src/server/current-operator-access";
import {
  boundedRequestBody, OPERATOR_COOKIE, resolveIsolatedOperatorConfig,
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

type Context = Readonly<{ params: Promise<{ cityid: string }> }>;
const cityIdRule = /^[a-z0-9-]{1,64}$/;

function error(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: privateHeaders });
}

function isolatedDshOrigin(raw: string | undefined): string | null {
  if (!raw?.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.port || url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash || raw !== url.origin) return null;
    return raw;
  } catch {
    return null;
  }
}

function trustedRequest(request: NextRequest, browserOrigin: string, mutation: boolean) {
  const url = new URL(request.url);
  if (url.origin !== browserOrigin || url.search !== "" ||
      request.headers.get("host") !== url.host ||
      (mutation && request.headers.get("origin") !== browserOrigin)) return false;
  if (request.headers.has("x-forwarded-host") &&
      request.headers.get("x-forwarded-host") !== url.host) return false;
  if (request.headers.has("x-forwarded-proto") &&
      request.headers.get("x-forwarded-proto") !== "http") return false;
  return !["authorization", "x-actor-id", "x-operator-role", "x-role"].some(
    name => request.headers.has(name),
  );
}

function parseChange(raw: string | null): CityStoreOperationalPolicyChange | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 8192) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as CityStoreOperationalPolicyChange : null;
  } catch {
    return null;
  }
}

async function forward(
  request: NextRequest, context: Context, mutation: boolean,
): Promise<NextResponse> {
  const config = resolveIsolatedOperatorConfig(process.env);
  const dshOrigin = isolatedDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!config) return unavailableSessionResponse();
  if (!dshOrigin) return error("DSH_OWNER_UNAVAILABLE", 503);
  const { cityid: cityId } = await context.params;
  if (!cityIdRule.test(cityId) || !trustedRequest(request, config.browserOrigin, mutation)) {
    return error("INVALID_REQUEST", 400);
  }
  const access = await currentOperatorAccess();
  if (!access) return error("UNAUTHORIZED", 401);
  if (!access.grants.includes("platform_policies") ||
      request.headers.get("X-BThwani-Operator") !== encodeURIComponent(access.actorId)) {
    return error("FORBIDDEN", 403);
  }
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return error("UNAUTHORIZED", 401);

  let change: CityStoreOperationalPolicyChange | null = null;
  if (mutation) {
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return error("INVALID_REQUEST", 400);
    }
    change = parseChange(await boundedRequestBody(request));
    if (!change) return error("INVALID_REQUEST", 400);
  }

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const result = change
      ? await replaceCityStoreOperationalPolicy(dshOrigin, cityId, bearer, change, signal)
      : await getCityStoreOperationalPolicy(dshOrigin, cityId, bearer, signal);
    if ("policy" in result && result.policy.changedByActor !== access.actorId) {
      return error("DSH_OWNER_UNAVAILABLE", 503);
    }
    return NextResponse.json(result, { status: 200, headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof DshPublicError) {
      if (cause.status === 400) return error("INVALID_REQUEST", 400);
      if (cause.status === 401) return error("UNAUTHORIZED", 401);
      if (cause.status === 403) return error("FORBIDDEN", 403);
      if (cause.status === 409) return error("VERSION_CONFLICT", 409);
    }
    // On a mutation, 503 can mean COMMITTED with a lost reply. The browser
    // preserves its operationId and payload for reconciliation, not a new key.
    return error("DSH_OWNER_UNAVAILABLE", 503);
  }
}

export async function GET(request: NextRequest, context: Context) {
  return forward(request, context, false);
}

export async function PATCH(request: NextRequest, context: Context) {
  return forward(request, context, true);
}
