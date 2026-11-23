import {
  type CustomerCartChange,
  DshCartError, readCurrentCustomerCart, replaceCurrentCustomerCart,
} from "@bthwani/dsh";
import { IdentityClientError, readVerifiedIdentitySession } from "@bthwani/identity";
import { bearerForCustomerRequest } from "../access/customer-session-cookie.ts";

const noStore = {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;
const storeRule = /^[a-z0-9-]{1,64}$/;

function result(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStore });
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
async function boundedChange(request: Request): Promise<CustomerCartChange | null> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  const textSize = 8192;
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > textSize)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(2000)]);
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<null>(resolve => {
    onAbort = () => resolve(null);
    if (readSignal.aborted) resolve(null);
    else readSignal.addEventListener("abort", onAbort, { once: true });
  });
  const bytes = new Uint8Array(textSize);
  let used = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next === null) return null;
      const { done, value } = next;
      if (done) break;
      if (used + value.length > bytes.length) return null;
      bytes.set(value, used);
      used += value.length;
    }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used)));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const obj = payload as Record<string, unknown>;
    if (!exactKeys(obj, ["operationId", "expectedVersion", "lines"]) || !Array.isArray(obj.lines) ||
      obj.lines.length > 20 || !obj.lines.every(line => line && typeof line === "object" &&
        !Array.isArray(line) && exactKeys(line as Record<string, unknown>, ["offerId", "quantity"]))) {
      return null;
    }
    return payload as CustomerCartChange;
  } catch {
    return null;
  } finally {
    if (onAbort) readSignal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Customer Web is a cookie-only presentation adapter. Identity and DSH own truth. */
export async function handleCustomerCart(request: Request, method: "GET" | "PUT"): Promise<Response> {
  const url = new URL(request.url);
  const storeIds = url.searchParams.getAll("storeId");
  const origin = process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  const identityOrigin = process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN;
  if (process.env.BTHWANI_SURFACE_PREVIEW !== "1" || !origin || !identityOrigin ||
    !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return result({ error: "OWNER_UNAVAILABLE" }, 503);
  }
  const storeId = storeIds[0];
  if (url.searchParams.size !== 1 || storeIds.length !== 1 || !storeId || !storeRule.test(storeId)) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return result({ error: "FORBIDDEN" }, 403);
  if (method === "PUT" && request.headers.get("Origin") !== url.origin) {
    return result({ error: "FORBIDDEN" }, 403);
  }
  if (method === "GET" && (request.body || request.headers.get("Content-Length"))) {
    return result({ error: "INVALID_REQUEST" }, 400);
  }
  const change = method === "PUT" ? await boundedChange(request) : null;
  if (method === "PUT" && !change) return result({ error: "INVALID_REQUEST" }, 400);
  const bearer = bearerForCustomerRequest(request);
  if (!bearer) return result({ error: "UNAUTHORIZED" }, 401);
  let dispatched = false;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10500)]);
    const before = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    if (before.role !== "customer") return result({ error: "FORBIDDEN" }, 403);
    dispatched = method === "PUT";
    const value = method === "GET"
      ? await readCurrentCustomerCart(origin, bearer, storeId, before.actorId, signal)
      : await replaceCurrentCustomerCart(origin, bearer, storeId, before.actorId, change as CustomerCartChange, signal);
    const after = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    if (signal.aborted || after.role !== "customer" || before.actorId !== after.actorId) {
      return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" }, dispatched ? 503 : 401);
    }
    return result(value);
  } catch (error) {
    if (error instanceof DshCartError) {
      const allowed = [400, 401, 403, 404, 409].includes(error.status);
      return result({ error: allowed ? error.code : dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" },
        allowed ? error.status : 503);
    }
    if (error instanceof IdentityClientError && [401, 403].includes(error.status)) {
      return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED" },
        dispatched ? 503 : error.status);
    }
    return result({ error: dispatched ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE" }, 503);
  }
}
