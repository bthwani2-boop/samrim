import {
  DshPublicError,
  type FavoriteStorePage,
  type FavoriteStoreState,
  getCustomerFavoriteStore,
  isFavoriteStoreId,
  listCustomerFavoriteStores,
  parseFavoriteStorePage,
  parseFavoriteStoreState,
  setCustomerFavoriteStore,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOrigin = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route = "/api/customer-auth/favorite-stores";
type Verified<T> = { value: T; expiresAt: number };

export async function verifyFavoriteSession(signal: AbortSignal, actor?: string) {
  signal.throwIfAborted();
  const admission = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  const session = admission.session;
  if (!admission.enabled || session?.role !== "customer" ||
    (actor !== undefined && actor !== session.actorId) ||
    !(Date.parse(session.sessionExpiresAt) > Date.now())) {
    throw new DshPublicError(401, "UNAUTHORIZED");
  }
  return session;
}

// The bounded reader owns an acquired stream; rejected envelopes remain
// the transport's responsibility. Cleanup cannot change the owner outcome.
async function discardUnread(response: Response): Promise<void> {
  try {
    const body = response.body;
    if (!response.bodyUsed && body && !body.locked) await body.cancel();
  } catch {
    // Cancellation is best effort; never await it on the request path.
  }
}

async function webRequest(
  actor: string, query: URLSearchParams, signal: AbortSignal, method: "GET" | "PUT",
): Promise<unknown> {
  signal.throwIfAborted();
  const write = method === "PUT";
  let response: Response;
  const suffix = query.size ? "?" + query.toString() : "";
  try {
    response = await fetch(route + suffix, {
      method, credentials: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { "X-Customer-Context": actor },
    });
  } catch {
    signal.throwIfAborted();
    throw new DshPublicError(503, write ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE");
  }
  try {
    signal.throwIfAborted();
    if (!response.ok) {
      throw new DshPublicError(response.status, write && response.status >= 500
        ? "OPERATION_RESULT_UNKNOWN" : "FAVORITE_REQUEST_REJECTED");
    }
    if (response.status !== 200 || response.headers.get("Cache-Control") !== "no-store") {
      throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    }
    const value = await readBoundedCustomerJSON({
      headers: response.headers, body: response.body, signal,
    });
    signal.throwIfAborted();
    if (value === null) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    return value;
  } finally {
    void discardUnread(response);
  }
}

async function verified<T extends { actorId: string }>(
  signal: AbortSignal,
  actor: string | undefined,
  web: (actor: string) => Promise<T>,
  native: (origin: string, actor: string, bearer: string) => Promise<T>,
  mutating = false,
): Promise<Verified<T>> {
  const before = await verifyFavoriteSession(signal, actor);
  const initialExpiry = Date.parse(before.sessionExpiresAt);
  let dispatched = false;
  try {
    let result: Verified<T>;
    if (Platform.OS === "web") {
      dispatched = mutating;
      const value = await web(before.actorId);
      const after = await verifyFavoriteSession(signal, before.actorId);
      result = { value, expiresAt: Math.min(initialExpiry, Date.parse(after.sessionExpiresAt)) };
    } else {
      if (!nativeOrigin) throw new DshPublicError(503, "OWNER_UNAVAILABLE");
      const origin = nativeOrigin;
      const outcome = await withVerifiedNativeCustomerRead(signal, bearer => {
        signal.throwIfAborted();
        dispatched = mutating;
        return native(origin, before.actorId, bearer);
      }, before.actorId);
      if (outcome.kind !== "ready") {
        throw new DshPublicError(outcome.kind === "signed-out" ? 401 : 503, "OWNER_UNAVAILABLE");
      }
      result = { value: outcome.value, expiresAt: Math.min(initialExpiry, outcome.expiresAt) };
    }
    signal.throwIfAborted();
    if (result.value.actorId !== before.actorId || !(result.expiresAt > Date.now())) {
      throw new DshPublicError(401, "UNAUTHORIZED");
    }
    return result;
  } catch (error) {
    // A dispatched write with missing confirmation may have committed.
    // Only definitive owner input/not-found rejections remain definitive.
    if (dispatched && (!(error instanceof DshPublicError) || ![400, 404].includes(error.status))) {
      throw new DshPublicError(503, "OPERATION_RESULT_UNKNOWN");
    }
    throw error;
  }
}

export async function readFavoriteStores(
  signal: AbortSignal, actor?: string, after?: string,
): Promise<Verified<FavoriteStorePage>> {
  if (after !== undefined && !isFavoriteStoreId(after)) throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams(after === undefined ? {} : { after });
  return verified(signal, actor,
    async a => parseFavoriteStorePage(await webRequest(a, query, signal, "GET"), a, after),
    (origin, a, bearer) => listCustomerFavoriteStores(origin, bearer, a, after, signal));
}

export async function readFavoriteStore(
  signal: AbortSignal, id: string, actor?: string,
): Promise<Verified<FavoriteStoreState>> {
  if (!isFavoriteStoreId(id)) throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams({ storeId: id });
  return verified(signal, actor,
    async a => parseFavoriteStoreState(await webRequest(a, query, signal, "GET"), a, id),
    (origin, a, bearer) => getCustomerFavoriteStore(origin, bearer, a, id, signal));
}

export async function writeFavoriteStore(
  signal: AbortSignal, actor: string, id: string, favorite: boolean,
): Promise<Verified<FavoriteStoreState>> {
  if (!isFavoriteStoreId(id) || typeof favorite !== "boolean") throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams({ storeId: id, favorite: String(favorite) });
  return verified(signal, actor,
    async a => parseFavoriteStoreState(await webRequest(a, query, signal, "PUT"), a, id, favorite),
    (origin, a, bearer) => setCustomerFavoriteStore(origin, bearer, a, id, favorite, signal), true);
}
