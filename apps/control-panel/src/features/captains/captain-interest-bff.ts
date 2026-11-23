import "server-only";
import {
  DshPublicError, listOperatorCaptainInterest, markOperatorCaptainInterestContacted,
  type OperatorCaptainInterestFilter,
} from "@bthwani/dsh";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  isTrustedOperatorLoopbackTarget,
  OPERATOR_COOKIE, readVerifiedOperatorAccess, resolveIsolatedOperatorConfig,
} from "../../server/operator-passkey-bff";
import { isolatedPublicDshOrigin } from "../stores/public-store-query";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const fail = (code: string, status: number) =>
  NextResponse.json({ code }, { status, headers: privateHeaders });

export async function readCaptainInterestForOperator(request: Request, candidateId?: string) {
  const config = resolveIsolatedOperatorConfig(process.env);
  const dsh = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!config || !dsh) return fail("OWNER_UNAVAILABLE", 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const changing = candidateId !== undefined;
  if (request.method !== (changing ? "PATCH" : "GET")) return fail("METHOD_NOT_ALLOWED", 405);
  // Reuse the exact Operator SSH tunnel trust check; candidate filter and
  // mutation parameters are validated separately before reaching DSH.
  if (!isTrustedOperatorLoopbackTarget(request, config.browserOrigin, true) ||
    (origin !== null && origin !== config.browserOrigin) ||
    (site !== null && site !== "same-origin" && site !== "none")) {
    return fail("FORBIDDEN", 403);
  }
  if (changing && (origin !== config.browserOrigin ||
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")) {
    return fail("FORBIDDEN", 403);
  }
  if (changing && (!candidateId || !/^[1-9][0-9]*$/.test(candidateId) ||
      !Number.isSafeInteger(Number(candidateId)))) {
    return fail("INVALID_REQUEST", 400);
  }
  if (url.search.length > 512 || (changing && url.search !== "")) return fail("INVALID_REQUEST", 400);
  const query = url.searchParams;
  if (!changing && [...query.keys()].some(key =>
      !["limit", "before", "city", "vehicle", "contacted"].includes(key) ||
      query.getAll(key).length !== 1)) return fail("INVALID_REQUEST", 400);
  const limit = query.get("limit") ?? "20";
  const before = query.get("before");
  const city = query.get("city");
  const vehicle = query.get("vehicle");
  const contacted = query.get("contacted");
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit) ||
      before !== null && (!/^[1-9][0-9]*$/.test(before) || !Number.isSafeInteger(Number(before))) ||
      city !== null && (city.trim() !== city || city.length < 2 || city.length > 80) ||
      vehicle !== null && !["MOTORCYCLE","ELECTRIC","BICYCLE","NONE"].includes(vehicle) ||
      contacted !== null && contacted !== "true" && contacted !== "false") {
    return fail("INVALID_REQUEST", 400);
  }
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) return fail("UNAUTHORIZED", 401);
  const access = await readVerifiedOperatorAccess(config, bearer);
  if (!access) return fail("UNAUTHORIZED", 401);
  if (!access.grants.includes("operations")) return fail("FORBIDDEN", 403);
  const operatorBinding = encodeURIComponent(access.actorId);
  if (changing && request.headers.get("X-BThwani-Operator") !== operatorBinding) {
    return fail("FORBIDDEN", 403);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  try {
    let result: unknown;
    if (changing) {
      if (request.headers.get("content-length") !== null &&
        (!/^\d+$/.test(request.headers.get("content-length") ?? "") ||
          Number(request.headers.get("content-length")) > 64)) {
        return fail("INVALID_REQUEST", 400);
      }
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 64) return fail("INVALID_REQUEST", 400);
      if (raw !== '{"contacted":true}' && raw !== '{ "contacted": true }') {
        return fail("INVALID_REQUEST", 400);
      }
      result = await markOperatorCaptainInterestContacted(dsh, bearer, Number(candidateId), signal);
    } else {
      const opts: OperatorCaptainInterestFilter = {
        limit: Number(limit),
        ...(before === null ? {} : { before: Number(before) }),
        ...(city === null ? {} : { city }),
        ...(vehicle === null ? {} : { vehicle: vehicle as "MOTORCYCLE" | "ELECTRIC" | "BICYCLE" | "NONE" }),
        ...(contacted === null ? {} : { contacted: contacted === "true" }),
      };
      result = await listOperatorCaptainInterest(dsh, bearer, { ...opts, signal });
    }
    if (signal.aborted) return fail("OWNER_UNAVAILABLE", 503);
    return NextResponse.json(result, {
      status: 200,
      headers: { ...privateHeaders, "X-BThwani-Operator": operatorBinding },
    });
  } catch (reason) {
    if (reason instanceof DshPublicError) {
      if (reason.status === 400) return fail("INVALID_REQUEST", 400);
      if (reason.status === 401) return fail("UNAUTHORIZED", 401);
      if (reason.status === 403) return fail("FORBIDDEN", 403);
      if (reason.status === 404) return fail("NOT_FOUND", 404);
      if (reason.code === "OPERATION_RESULT_UNKNOWN") return fail("OPERATION_RESULT_UNKNOWN", 503);
    }
    return fail("OWNER_UNAVAILABLE", 503);
  }
}
