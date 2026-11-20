import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { currentOperatorAccess } from "../../../../../src/server/current-operator-access";
import {
  boundedRequestBody, boundedResponseJSON, OPERATOR_COOKIE, resolveIsolatedOperatorConfig,
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
type CityPolicy = Readonly<{
  cityId: string;
  version: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  changedByActor: string;
  changeReason: string;
  updatedAt: string;
}>;

const cityIdRule = /^[a-z0-9-]{1,64}$/;
const operationIdRule = /^[A-Za-z0-9._-]{8,128}$/;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function parsePolicy(value: unknown, requestedCity: string): CityPolicy | null {
  const policy = asRecord(value);
  if (!policy || policy.cityId !== requestedCity ||
      !boundedInteger(policy.version, 1, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(policy.maxPauseSeconds, 0, 31536000) ||
      !boundedInteger(policy.maxPreparationMinutes, 0, 1440) ||
      typeof policy.changedByActor !== "string" || !policy.changedByActor.trim() ||
      policy.changedByActor.length > 128 ||
      typeof policy.changeReason !== "string" || !policy.changeReason.trim() ||
      [...policy.changeReason].length > 300 ||
      typeof policy.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(policy.updatedAt))) return null;
  return {
    cityId: requestedCity,
    version: policy.version,
    maxPauseSeconds: policy.maxPauseSeconds,
    maxPreparationMinutes: policy.maxPreparationMinutes,
    changedByActor: policy.changedByActor,
    changeReason: policy.changeReason,
    updatedAt: policy.updatedAt,
  };
}

function parseChange(raw: string): Record<string, unknown> | null {
  try {
    const change = asRecord(JSON.parse(raw) as unknown);
    if (!change || Object.keys(change).length !== 5 ||
        !["operationId", "expectedVersion", "maxPauseSeconds", "maxPreparationMinutes", "reason"]
          .every(key => Object.hasOwn(change, key)) ||
        typeof change.operationId !== "string" ||
        !operationIdRule.test(change.operationId) ||
        !boundedInteger(change.expectedVersion, 0, Number.MAX_SAFE_INTEGER) ||
        !boundedInteger(change.maxPauseSeconds, 0, 31536000) ||
        !boundedInteger(change.maxPreparationMinutes, 0, 1440) ||
        typeof change.reason !== "string" || !change.reason.trim() ||
        [...change.reason].length > 300) return null;
    return {
      operationId: change.operationId,
      expectedVersion: change.expectedVersion,
      maxPauseSeconds: change.maxPauseSeconds,
      maxPreparationMinutes: change.maxPreparationMinutes,
      reason: change.reason,
    };
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
  if (!access.grants.includes("platform_policies")) return error("FORBIDDEN", 403);
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return error("UNAUTHORIZED", 401);

  let body = "";
  if (mutation) {
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      return error("INVALID_REQUEST", 400);
    }
    const raw = await boundedRequestBody(request);
    if (!raw || raw.length > 8192) return error("INVALID_REQUEST", 400);
    const change = parseChange(raw);
    if (!change) return error("INVALID_REQUEST", 400);
    // Canonical serialization forwards exactly the validated command, never
    // actor/role claims, unknown members or an ambiguous raw JSON envelope.
    body = JSON.stringify(change);
  }

  try {
    const upstream = await fetch(
      `${dshOrigin}/v1/operators/cities/${cityId}/store-availability-policy`, {
        method: mutation ? "PATCH" : "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(mutation ? { "Content-Type": "application/json" } : {}),
        },
        ...(mutation ? { body } : {}),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (upstream.status !== 200) {
      return error(
        upstream.status === 400 ? "INVALID_REQUEST" :
        upstream.status === 401 ? "UNAUTHORIZED" :
        upstream.status === 403 ? "FORBIDDEN" :
        upstream.status === 409 ? "VERSION_CONFLICT" : "DSH_OWNER_UNAVAILABLE",
        [400, 401, 403, 409].includes(upstream.status) ? upstream.status : 503,
      );
    }
    const value = await boundedResponseJSON(upstream);
    const result = mutation ? asRecord(value) : null;
    const policy = parsePolicy(mutation ? result?.policy : value, cityId);
    if (!policy || (mutation && typeof result?.replay !== "boolean")) {
      return error("DSH_OWNER_UNAVAILABLE", 503);
    }
    return NextResponse.json(
      mutation ? { policy, replay: result?.replay } : policy,
      { status: 200, headers: privateHeaders },
    );
  } catch {
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
