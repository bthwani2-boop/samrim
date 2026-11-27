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
import { discardCustomerResponse, readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOrigin = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route = "/api/customer-auth/favorite-stores";
const requestDeadlineMs = 20_000;
type Verified<T> = { value: T; expiresAt: number };

function unknownWrite(): DshPublicError {
  return new DshPublicError(503, "OPERATION_RESULT_UNKNOWN");
}

// Own the entire request, including both Identity reads and the owner reply.
// A bridge that ignores cancellation must not hold the UI or dispatch late.
async function withinLifetime<T>(
  caller: AbortSignal,
  run: (signal: AbortSignal, markDispatched: () => void) => Promise<T>,
): Promise<T> {
  caller.throwIfAborted();
  const controller = new AbortController();
  let dispatched = false;
  let rejectStopped!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  function interrupt(reason: unknown) {
    rejectStopped(dispatched ? unknownWrite() : reason);
    controller.abort(reason);
  }
  const cancel = () => interrupt(caller.reason);
  caller.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => interrupt(new DshPublicError(503, "OWNER_UNAVAILABLE")), requestDeadlineMs);
  try {
    const result = await Promise.race([
      run(controller.signal, () => {
        controller.signal.throwIfAborted();
        dispatched = true;
      }),
      stopped,
    ]);
    if (controller.signal.aborted) throw dispatched ? unknownWrite() : controller.signal.reason;
    return result;
  } finally {
    clearTimeout(deadline);
    caller.removeEventListener("abort", cancel);
  }
}

async function readSession(signal: AbortSignal, actor?: string) {
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

export function verifyFavoriteSession(signal: AbortSignal, actor?: string) {
  return withinLifetime(signal, current => readSession(current, actor));
}

async function webRequest(
  actor: string, query: URLSearchParams, signal: AbortSignal, method: "GET" | "PUT",
): Promise<unknown> {
  signal.throwIfAborted();
  const write = method === "PUT";
  const suffix = query.size ? `?${query.toString()}` : "";
  let response: Response;
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
    discardCustomerResponse(response);
  }
}

function verified<T extends { actorId: string }>(
  caller: AbortSignal,
  actor: string | undefined,
  web: (actor: string, signal: AbortSignal) => Promise<T>,
  native: (origin: string, actor: string, bearer: string, signal: AbortSignal) => Promise<T>,
  mutating = false,
): Promise<Verified<T>> {
  return withinLifetime(caller, async (signal, markDispatched) => {
    const before = await readSession(signal, actor);
    const initialExpiry = Date.parse(before.sessionExpiresAt);
    let dispatched = false;
    function markWrite() {
      signal.throwIfAborted();
      if (mutating) {
        markDispatched();
        dispatched = true;
      }
    }
    try {
      let result: Verified<T>;
      if (Platform.OS === "web") {
        markWrite();
        const value = await web(before.actorId, signal);
        const after = await readSession(signal, before.actorId);
        result = { value, expiresAt: Math.min(initialExpiry, Date.parse(after.sessionExpiresAt)) };
      } else {
        if (!nativeOrigin) throw new DshPublicError(503, "OWNER_UNAVAILABLE");
        const origin = nativeOrigin;
        const outcome = await withVerifiedNativeCustomerRead(signal, bearer => {
          markWrite();
          return native(origin, before.actorId, bearer, signal);
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
      // Only a definitive owner rejection can settle a dispatched mutation.
      if (dispatched && (!(error instanceof DshPublicError) || ![400, 404].includes(error.status))) {
        throw unknownWrite();
      }
      throw error;
    }
  });
}

export async function readFavoriteStores(
  signal: AbortSignal, actor?: string, after?: string,
): Promise<Verified<FavoriteStorePage>> {
  if (after !== undefined && !isFavoriteStoreId(after)) throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams(after === undefined ? {} : { after });
  return verified(signal, actor,
    async (a, current) => parseFavoriteStorePage(await webRequest(a, query, current, "GET"), a, after),
    (origin, a, bearer, current) => listCustomerFavoriteStores(origin, bearer, a, after, current));
}

export async function readFavoriteStore(
  signal: AbortSignal, id: string, actor?: string,
): Promise<Verified<FavoriteStoreState>> {
  if (!isFavoriteStoreId(id)) throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams({ storeId: id });
  return verified(signal, actor,
    async (a, current) => parseFavoriteStoreState(await webRequest(a, query, current, "GET"), a, id),
    (origin, a, bearer, current) => getCustomerFavoriteStore(origin, bearer, a, id, current));
}

export async function writeFavoriteStore(
  signal: AbortSignal, actor: string, id: string, favorite: boolean,
): Promise<Verified<FavoriteStoreState>> {
  if (!isFavoriteStoreId(id) || typeof favorite !== "boolean") throw new DshPublicError(400, "INVALID_REQUEST");
  const query = new URLSearchParams({ storeId: id, favorite: String(favorite) });
  return verified(signal, actor,
    async (a, current) => parseFavoriteStoreState(await webRequest(a, query, current, "PUT"), a, id, favorite),
    (origin, a, bearer, current) => setCustomerFavoriteStore(origin, bearer, a, id, favorite, current), true);
}
