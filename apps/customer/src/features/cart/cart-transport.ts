import {
  DshCartError, parseCustomerCart, parseCustomerCartResult,
  readCurrentCustomerCart, replaceCurrentCustomerCart, readCurrentCustomerCartMerchandiseEstimate,
  parseCustomerCartMerchandiseEstimate,
  type CustomerCart, type CustomerCartChange, type CustomerCartResult, type CustomerCartMerchandiseEstimate,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import {
  readCustomerAdmission, withVerifiedNativeCustomerRead,
} from "../access/customer-session-transport";

export type CartReadState = { kind: "ready"; cart: CustomerCart } |
  { kind: "signed-out" | "unavailable" };
const nativeOwner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const idRule = /^[a-z0-9-]{1,64}$/;

async function admission(signal: AbortSignal) {
  const result = await readCustomerAdmission(signal);
  if (!result.enabled) return { kind: "unavailable" as const };
  if (result.session?.role !== "customer" ||
    Date.parse(result.session.sessionExpiresAt) <= Date.now()) return { kind: "signed-out" as const };
  return { kind: "ready" as const, session: result.session };
}
function requireStore(storeId: string) {
  if (!idRule.test(storeId)) throw new DshCartError(400, "INVALID_REQUEST");
}
function cartPath(storeId: string) {
  return `/api/customer-auth/cart?storeId=${encodeURIComponent(storeId)}`;
}
async function currentAfter(signal: AbortSignal, originalActor: string): Promise<boolean> {
  const current = await admission(signal);
  return !signal.aborted && current.kind === "ready" && current.session.actorId === originalActor;
}

/** Customer's identity and Store scope must be current both before and after every read. */
export async function readVerifiedCart(storeId: string, signal: AbortSignal): Promise<CartReadState> {
  requireStore(storeId);
  const state = await admission(signal);
  if (state.kind !== "ready") return state;
  if (Platform.OS === "web") {
    let response: Response;
    try {
      response = await fetch(cartPath(storeId), {
        method: "GET", credentials: "same-origin", cache: "no-store",
        redirect: "error", signal,
      });
    } catch { throw new DshCartError(503, "OWNER_NETWORK_UNAVAILABLE"); }
    if (signal.aborted) throw new DshCartError(0, "OWNER_RESPONSE_STALE");
    if (response.status === 401 || response.status === 403) return { kind: "signed-out" };
    if (response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
      throw new DshCartError(503, "OWNER_UNAVAILABLE");
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new DshCartError(502, "OWNER_RESPONSE_INVALID"); }
    const cart = parseCustomerCart(value, storeId, state.session.actorId);
    if (!await currentAfter(signal, state.session.actorId)) return { kind: "signed-out" };
    return { kind: "ready", cart };
  }
  if (!nativeOwner) return { kind: "unavailable" };
  const native = await withVerifiedNativeCustomerRead(signal, bearer =>
    readCurrentCustomerCart(nativeOwner, bearer, storeId, state.session.actorId, signal),
    state.session.actorId);
  return native.kind === "ready" ? { kind: "ready", cart: native.value } : native;
}

/** No duplicate write after uncertain dispatch; the caller retains operationId for recovery. */
export async function replaceVerifiedCart(storeId: string, change: CustomerCartChange,
  expectedActorId: string, signal: AbortSignal): Promise<CustomerCartResult> {
  requireStore(storeId);
  const state = await admission(signal);
  if (state.kind !== "ready" || state.session.actorId !== expectedActorId) {
    throw new DshCartError(401, "UNAUTHORIZED");
  }
  if (Platform.OS === "web") {
    if (typeof window === "undefined") throw new DshCartError(503, "OWNER_UNAVAILABLE");
    let response: Response;
    try {
      response = await fetch(cartPath(storeId), {
        method: "PUT", signal, credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify(change),
      });
    } catch { throw new DshCartError(0, "OPERATION_RESULT_UNKNOWN"); }
    if (signal.aborted) throw new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
    if (response.status !== 200) {
      throw new DshCartError(response.status,
        response.status === 409 ? "CART_VERSION_OR_OPERATION_CONFLICT" :
        response.status === 400 ? "INVALID_REQUEST" :
        response.status === 401 || response.status === 403 ? "UNAUTHORIZED" :
        response.status === 404 ? "STORE_OR_OFFER_NOT_AVAILABLE" : "OPERATION_RESULT_UNKNOWN");
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new DshCartError(502, "OPERATION_RESULT_UNKNOWN"); }
    let result: CustomerCartResult;
    try { result = parseCustomerCartResult(value, storeId, state.session.actorId, change.expectedVersion); }
    catch { throw new DshCartError(502, "OPERATION_RESULT_UNKNOWN"); }
    if (!await currentAfter(signal, state.session.actorId)) throw new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
    return result;
  }
  if (!nativeOwner) throw new DshCartError(503, "OWNER_UNAVAILABLE");
  let dispatched = false;
  // Reuse the already verified native bearer/session race guard. If the actor
  // changes after dispatch, a write may have committed: NEVER call it failed.
  const verified = await withVerifiedNativeCustomerRead(signal, async bearer => {
    dispatched = true;
    const result = await replaceCurrentCustomerCart(
      nativeOwner, bearer, storeId, state.session.actorId, change, signal);
    return { ...result.cart, replay: result.replay };
  }, state.session.actorId).catch(error => {
    if (dispatched && !(error instanceof DshCartError)) {
      throw new DshCartError(0, "OPERATION_RESULT_UNKNOWN");
    }
    throw error;
  });
  if (verified.kind !== "ready") {
    throw new DshCartError(dispatched ? 0 : 401,
      dispatched ? "OPERATION_RESULT_UNKNOWN" : "UNAUTHORIZED");
  }
  const { replay, ...cart } = verified.value;
  return { cart, replay };
}

export type MerchandiseEstimateReadState = { kind: "ready"; estimate: CustomerCartMerchandiseEstimate } |
  { kind: "signed-out" | "unavailable" };

/** Read a DSH merchandise-only amount for an exact Cart version, never a payable quote. */
export async function readVerifiedCartMerchandiseEstimate(storeId: string, expectedVersion: number,
  expectedActorId: string, signal: AbortSignal): Promise<MerchandiseEstimateReadState> {
  requireStore(storeId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new DshCartError(400, "INVALID_REQUEST");
  }
  const state = await admission(signal);
  if (state.kind !== "ready") return state;
  if (state.session.actorId !== expectedActorId) return { kind: "signed-out" };
  if (Platform.OS === "web") {
    const url = `/api/customer-auth/cart-estimate?storeId=${encodeURIComponent(storeId)}&expectedVersion=${expectedVersion}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET", credentials: "same-origin", cache: "no-store",
        redirect: "error", signal,
      });
    } catch { throw new DshCartError(503, "OWNER_NETWORK_UNAVAILABLE"); }
    if (signal.aborted) throw new DshCartError(0, "OWNER_RESPONSE_STALE");
    if (response.status === 401 || response.status === 403) return { kind: "signed-out" };
    if (response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
      throw new DshCartError(response.status, "ESTIMATE_NOT_AVAILABLE");
    }
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new DshCartError(502, "OWNER_RESPONSE_INVALID"); }
    const estimate = parseCustomerCartMerchandiseEstimate(raw, storeId, expectedActorId, expectedVersion);
    if (!await currentAfter(signal, expectedActorId)) return { kind: "signed-out" };
    return { kind: "ready", estimate };
  }
  if (!nativeOwner) return { kind: "unavailable" };
  const native = await withVerifiedNativeCustomerRead(signal, bearer =>
    readCurrentCustomerCartMerchandiseEstimate(nativeOwner, bearer, storeId, expectedActorId, expectedVersion, signal),
    expectedActorId);
  return native.kind === "ready" ? { kind: "ready", estimate: native.value } : native;
}
