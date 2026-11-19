import "server-only";
import {type CaptainStandingStatus,
  captainStandingStatuses, changeOperatorCaptainStanding, DshPublicError, getOperatorCaptainStanding, isCaptainStandingActorId,
  listOperatorCaptainStandings,
} from "@bthwani/dsh";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OPERATOR_COOKIE, readVerifiedOperatorAccess, resolveIsolatedOperatorConfig,
} from "../../server/operator-passkey-bff";
import { isolatedPublicDshOrigin } from "../stores/public-store-query";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};
const error = (code: string, status: number) => NextResponse.json({ code }, { status, headers: privateHeaders });

/** Fixed read routes only; the browser supplies neither an owner URL nor an
 * authenticated actor. The same HttpOnly bearer is checked and forwarded. */
export async function readCaptainReview(request: Request, actorId?: string) {
  const config = resolveIsolatedOperatorConfig(process.env);
  const owner = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!config || !owner) return error("OWNER_UNAVAILABLE", 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const allowed = actorId === undefined ? ["status", "limit", "cursor"] : [];
  const changing = request.method === "PATCH" && actorId !== undefined;
  if (request.method !== "GET" && !changing) return error("METHOD_NOT_ALLOWED", 405);
  if (changing && (origin !== config.browserOrigin ||
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")) {
    return error("FORBIDDEN", 403);
  }
  if (url.origin !== config.browserOrigin || request.headers.get("host") !== url.host ||
    (origin !== null && origin !== config.browserOrigin) ||
    (site !== null && site !== "same-origin" && site !== "none") ||
    (request.headers.has("x-forwarded-host") && request.headers.get("x-forwarded-host") !== url.host) ||
    (request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "http") ||
    ["authorization", "x-actor-id", "x-role", "x-operator-role"].some(name => request.headers.has(name))) {
    return error("FORBIDDEN", 403);
  }
  const params = url.searchParams;
  if (url.search.length > 2048 || [...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1) ||
    (actorId !== undefined && !isCaptainStandingActorId(actorId))) return error("INVALID_REQUEST", 400);
  try { decodeURIComponent(url.search); } catch { return error("INVALID_REQUEST", 400); }
  const status = params.get("status") ?? "PENDING";
  const limit = params.get("limit");
  const cursor = params.get("cursor");
  if (!captainStandingStatuses.includes(status as CaptainStandingStatus) ||
    (limit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)) ||
    (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor))) return error("INVALID_REQUEST", 400);
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return error("UNAUTHORIZED", 401);
  const access = await readVerifiedOperatorAccess(config, bearer);
  if (!access) return error("UNAUTHORIZED", 401);
  if (!access.grants.includes("operations")) return error("FORBIDDEN", 403);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  try {
    let result: unknown;
    if (changing && actorId !== undefined) {
      const len = request.headers.get("content-length");
      if (len !== null && (!/^\d+$/.test(len) || Number(len) > 2048)) return error("INVALID_REQUEST", 400);
      const reader = request.body?.getReader();
      if (!reader) return error("INVALID_REQUEST", 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2048) return error("INVALID_REQUEST", 400);
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      let change: unknown;
      try {
        change = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk))))) as unknown;
      } catch { return error("INVALID_REQUEST", 400); }
      if (!change || typeof change !== "object" || Array.isArray(change)) return error("INVALID_REQUEST", 400);
      const item = change as Record<string, unknown>;
      if (Object.keys(item).length !== 4 ||
        !["status", "expectedVersion", "operationId", "reason"].every(key => Object.hasOwn(item, key))) {
        return error("INVALID_REQUEST", 400);
      }
      result = await changeOperatorCaptainStanding(owner, actorId, bearer, {
        status: item.status as "APPROVED" | "SUSPENDED" | "REVOKED",
        expectedVersion: item.expectedVersion as number,
        operationId: item.operationId as string,
        reason: item.reason as string,
      }, signal);
    } else {
      result = actorId === undefined
        ? await listOperatorCaptainStandings(owner, bearer, {
          status: status as CaptainStandingStatus, ...(limit === null ? {} : { limit: Number(limit) }),
          ...(cursor === null ? {} : { cursor }), signal,
        })
        : await getOperatorCaptainStanding(owner, actorId, bearer, signal);
    }
    return NextResponse.json(result, { status: 200, headers: {
      ...privateHeaders, "X-BThwani-Operator": encodeURIComponent(access.actorId),
    } });
  } catch (reason) {
    if (reason instanceof DshPublicError) {
      const status = reason.status;
      if (status === 400) return error("INVALID_REQUEST", 400);
      if (status === 401) return error("UNAUTHORIZED", 401);
      if (status === 403) return error("FORBIDDEN", 403);
      if (status === 404 && actorId !== undefined) return error("NOT_FOUND", 404);
      if (status === 409 && changing) return error("CONFLICT", 409);
      if (changing && reason.code === "OPERATION_RESULT_UNKNOWN") return error("OPERATION_RESULT_UNKNOWN", 503);
    }
    return error("OWNER_UNAVAILABLE", 503);
  }
}
