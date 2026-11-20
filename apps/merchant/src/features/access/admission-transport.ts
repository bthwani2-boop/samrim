import { DshPublicError, getStoreOperationalAvailability, type StoreOperationalAvailability, type StoreOperationalChange, updateStoreOperationalAvailability } from "@bthwani/dsh";
import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { revokeUndeliveredAdmissionSession, verifyMerchantAdmission } from "./admission";
import { MerchantStandingError, readMerchantDSHStanding, standingFrom } from "./dsh-standing";

const storageKey = process.env.EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani.merchant.synthetic-admission.surface.v1" : "bthwani.merchant.synthetic-admission.v1";
// Persist before writing an issued bearer. An interrupted write must remain
// quarantined even after the JavaScript process loses its in-memory state.
const pendingStorageKey = `${storageKey}.pending.v1`;
const nativeOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
const nativeDSHOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type EntryState = { enabled: boolean; session: VerifiedIdentitySession | null };

// Serialize app-local SecureStore mutations so late owner responses cannot erase
// a newer sign-in written while the old request was in flight.
let nativeStorageMutation: Promise<void> = Promise.resolve();
let deniedNativeBearer: string | null = null;
let nativeAdmissionInFlight = false;
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeStorageMutation.then(operation);
  nativeStorageMutation = result.then(() => undefined, () => undefined);
  return result;
}
async function clearPendingNativeAdmission(signal: AbortSignal): Promise<boolean> {
  return mutateNativeStorage(async () => {
    const pending = await SecureStore.getItemAsync(pendingStorageKey, nativeOptions);
    if (!pending) return false;
    if (signal.aborted) return true;
    const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (bearer) {
      deniedNativeBearer = bearer;
      try {
        await SecureStore.deleteItemAsync(storageKey, nativeOptions);
      } catch {
        // Never delete the durable quarantine if bearer deletion is uncertain.
        return true;
      }
    }
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
    return true;
  });
}

function clearNativeBearerIfCurrent(bearer: string, signal: AbortSignal): Promise<void> {
  return mutateNativeStorage(async () => {
    if (signal.aborted) return;
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer || signal.aborted) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
  });
}

async function webRequest<T>(method: string, signal: AbortSignal, data?: object, stores = false): Promise<T> {
  const result = await fetch(stores ? "/api/admission?stores=mine" : "/api/admission", {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    ...(data === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  if (result.status === 204) return undefined as T;
  const body = await result.json();
  if (!result.ok) throw new IdentityClientError(result.status, body.code);
  return body as T;
}

function requireNativeOrigin() {
  if (!nativeOrigin) throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
  return nativeOrigin;
}

export async function readAdmission(signal: AbortSignal): Promise<EntryState> {
  if (Platform.OS === "web") return webRequest("GET", signal);
  if (!nativeOrigin) return { enabled: false, session: null };
  if (await clearPendingNativeAdmission(signal)) return { enabled: true, session: null };
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (bearer && bearer === deniedNativeBearer) {
    await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    return { enabled: true, session: null };
  }
  if (bearer) {
    try {
      const session = await readVerifiedIdentitySession(nativeOrigin, bearer, signal);
      if (session.role === "merchant") return { enabled: true, session };
    } catch (error) {
      if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
    }
    if (!signal.aborted) {
      // Identity denial (or a non-Merchant role) is authoritative even when
      // SecureStore is temporarily unable to delete the old credential.
      deniedNativeBearer = bearer;
      await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    }
  }
  return { enabled: true, session: null };
}

/** DSH Store standing is requested separately from session issuance. It never
 * grants entry to an unverified Store or mutates the business owner. */
export async function readMerchantStanding(signal: AbortSignal) {
  if (Platform.OS === "web") {
    const result = await webRequest<{ standing: unknown }>("GET", signal, undefined, true);
    return standingFrom(result.standing);
  }
  if (await clearPendingNativeAdmission(signal)) {
    throw new MerchantStandingError(401, "UNAUTHENTICATED");
  }
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) throw new MerchantStandingError(401, "UNAUTHENTICATED");
  try {
    return await readMerchantDSHStanding(nativeDSHOrigin ?? "", bearer, signal);
  } catch (error) {
    if (!signal.aborted &&
      (error instanceof MerchantStandingError || error instanceof IdentityClientError) &&
      (error.status === 401 || error.status === 403)) {
      deniedNativeBearer = bearer;
      // Owner denial remains authoritative if device storage is temporarily unavailable.
      await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    }
    throw error;
  }
}

/** Read-only Store projection. Identity proves the role; DSH authorizes the Store. */
export async function readMerchantAvailability(storeId: string, signal: AbortSignal, actorId?: string): Promise<StoreOperationalAvailability> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(400, "STORE_ID_INVALID");
  if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (Platform.OS === "web") {
    const result = await fetch(`/api/admission?availability=${encodeURIComponent(storeId)}`, {
      method: "GET", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      ...(actorId ? { headers: { "X-Merchant-Context": actorId } } : {}),
    });
    const body = await result.json();
    if (signal.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
    if (!result.ok) throw new DshPublicError(result.status, body.code);
    if (!body?.availability || body.availability.storeId !== storeId) {
      throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    }
    return body.availability as StoreOperationalAvailability;
  }
  return withNativeMerchantSession(signal, bearer =>
    getStoreOperationalAvailability(nativeDSHOrigin ?? "", storeId, bearer, signal), actorId);
}

async function withNativeMerchantSession<T>(signal: AbortSignal, run: (bearer: string) => Promise<T>, actorId?: string): Promise<T> {
  if (await clearPendingNativeAdmission(signal)) throw new IdentityClientError(401, "UNAUTHORIZED");
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer || bearer === deniedNativeBearer) throw new IdentityClientError(401, "UNAUTHORIZED");
  try {
    const session = await readVerifiedIdentitySession(requireNativeOrigin(), bearer, signal);
    if (session.role !== "merchant") throw new IdentityClientError(403, "FORBIDDEN");
    if (actorId !== undefined && session.actorId !== actorId) {
      throw new DshPublicError(403, "MERCHANT_CONTEXT_CHANGED");
    }
  } catch (error) {
    if (!signal.aborted && error instanceof IdentityClientError && (error.status === 401 || error.status === 403)) {
      deniedNativeBearer = bearer;
      await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    }
    throw error;
  }
  const afterIdentity = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (signal.aborted || bearer === deniedNativeBearer || afterIdentity !== bearer) {
    throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  }
  // A scoped 403 does not invalidate the Merchant's unrelated Store grants.
  const result = await run(bearer);
  const afterOwner = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (signal.aborted || bearer === deniedNativeBearer ||
      afterOwner !== bearer) {
    throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  }
  return result;
}

export async function saveMerchantAvailability(
  storeId: string, actorId: string, change: StoreOperationalChange, signal: AbortSignal,
): Promise<void> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId) || !actorId) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  signal.throwIfAborted();
  if (Platform.OS !== "web") {
    await withNativeMerchantSession(signal, bearer =>
      updateStoreOperationalAvailability(nativeDSHOrigin ?? "", storeId, bearer, change, signal), actorId);
    return;
  }
  const result = await fetch(`/api/admission?availability=${encodeURIComponent(storeId)}`, {
    method: "PATCH", signal, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", "X-Merchant-Context": actorId },
    body: JSON.stringify(change),
  });
  const body = await result.json();
  signal.throwIfAborted();
  if (!result.ok) throw new DshPublicError(result.status, body.code);
  if (typeof body?.replay !== "boolean" || body.availability?.storeId !== storeId) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
}

export async function requestAdmissionCode(phone: string, signal: AbortSignal): Promise<string> {
  if (Platform.OS === "web") return (await webRequest<{ ticket: string }>("POST", signal, { phone })).ticket;
  return issueCustomerPhoneChallenge(requireNativeOrigin(), phone, signal);
}

export async function submitAdmissionCode(
  ticket: string, code: string, signal: AbortSignal,
): Promise<VerifiedIdentitySession> {
  if (Platform.OS === "web") {
    return (await webRequest<{ session: VerifiedIdentitySession }>("POST", signal, { ticket, code })).session;
  }
  if (nativeAdmissionInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  nativeAdmissionInFlight = true;
  try {
    const origin = requireNativeOrigin();
    if (await clearPendingNativeAdmission(signal) &&
        await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
      throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
    }
    const previousBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (previousBearer && previousBearer !== deniedNativeBearer) {
      try {
        const active = await readVerifiedIdentitySession(origin, previousBearer, signal);
        if (active.role === "merchant") throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
      } catch (error) {
        if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
          throw error;
        }
      }
      if (!signal.aborted) {
        deniedNativeBearer = previousBearer;
        await clearNativeBearerIfCurrent(previousBearer, signal).catch(() => {});
      }
    }
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    const { session, bearer } = await verifyMerchantAdmission(origin, ticket, code, signal);
    try {
      if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      await mutateNativeStorage(async () => {
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // A concurrent sign-in may already have stored another verified actor.
        // Do not replace that credential with an earlier proof response.
        const currentBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
        if (currentBearer && currentBearer !== previousBearer) {
          throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
        }
        await SecureStore.setItemAsync(pendingStorageKey, "in-flight", nativeOptions);
        await SecureStore.setItemAsync(storageKey, bearer, nativeOptions);
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // Removing this marker is the native-device commit point.
        // After an acknowledged bearer write, uncertain marker deletion cannot
        // turn a committed token into an undelivered error. If it remains, the
        // next cold-start read will still reject the bearer until cleanup.
        await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
      });
      return session;
    } catch (error) {
      // SecureStore may write successfully and then report a device error.
      // Keep any undelivered bearer quarantined even if deletion itself fails.
      deniedNativeBearer = bearer;
      await mutateNativeStorage(async () => {
        if (await SecureStore.getItemAsync(storageKey, nativeOptions) === bearer) {
          await SecureStore.deleteItemAsync(storageKey, nativeOptions);
        }
      }).catch(() => {});
      await revokeUndeliveredAdmissionSession(origin, bearer);
      throw error;
    }
  } finally {
    nativeAdmissionInFlight = false;
  }
}

export async function signOutOfAdmission(signal: AbortSignal): Promise<void> {
  if (Platform.OS === "web") return webRequest("DELETE", signal);
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) return;
  try {
    await revokeVerifiedIdentitySession(requireNativeOrigin(), bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
  }
  await clearNativeBearerIfCurrent(bearer, signal);
}
