import { DshPublicError } from "@bthwani/dsh";
import {
  establishPersistentIdentitySession,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readPersistentIdentityRole,
  revokePersistentIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { revokeUndeliveredAdmissionSession, verifyMerchantAdmission } from "./admission";
import { MerchantStandingError, readMerchantDSHStanding } from "./dsh-standing";
import { readBrowserAdmission, readBrowserStanding, requestBrowserAdmissionCode, signOutBrowserAdmission, submitBrowserAdmissionCode } from "./merchant-admission-web.ts";

const storageKey = "bthwani.merchant.synthetic-admission.v1";
// Persist before writing an issued bearer. An interrupted write must remain
// quarantined even after the JavaScript process loses its in-memory state.
const pendingStorageKey = `${storageKey}.pending.v1`;
const refreshStorageKey = `${storageKey}.refresh.v1`;
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
    {
      const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
      if (refresh) {
        try { await revokePersistentIdentitySession(requireNativeOrigin(), refresh, signal); }
        catch (error) {
          if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
        }
      }
    }
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
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions).catch(() => {});
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
    return true;
  });
}

function clearNativeBearerIfCurrent(bearer: string, signal: AbortSignal): Promise<void> {
  return mutateNativeStorage(async () => {
    if (signal.aborted) return;
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer || signal.aborted) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions).catch(() => {});
  });
}

let durableMerchantInFlight: Promise<Awaited<ReturnType<typeof readPersistentIdentityRole>>> | null = null;
async function readDurableMerchant(bearer: string, signal: AbortSignal) {
  if (durableMerchantInFlight) return durableMerchantInFlight;
  const pending = (async () => {
  const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
  return readPersistentIdentityRole(requireNativeOrigin(), bearer, refresh, "merchant", signal,
    () => mutateNativeStorage(async () => {
      if (signal.aborted || await SecureStore.getItemAsync(pendingStorageKey, nativeOptions) ||
          await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer) {
        throw new IdentityClientError(0, "OWNER_RESPONSE_STALE");
      }
      await SecureStore.setItemAsync(pendingStorageKey, "refreshing", nativeOptions);
    }),
    (issued, before, rotated) => mutateNativeStorage(async () => {
      const pending = await SecureStore.getItemAsync(pendingStorageKey, nativeOptions);
      if ((!rotated && signal.aborted) || await SecureStore.getItemAsync(storageKey, nativeOptions) !== before ||
          (pending && (!rotated || pending !== "refreshing"))) return false;
      await SecureStore.setItemAsync(refreshStorageKey, issued.refreshToken, nativeOptions);
      if (rotated) {
        await SecureStore.setItemAsync(storageKey, issued.accessToken, nativeOptions);
        await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions);
      }
      return true;
    }));
  })();
  durableMerchantInFlight = pending;
  try { return await pending; }
  finally { if (durableMerchantInFlight === pending) durableMerchantInFlight = null; }
}

function requireNativeOrigin() {
  if (!nativeOrigin) throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
  return nativeOrigin;
}

export async function readAdmission(signal: AbortSignal): Promise<EntryState> {
  if (Platform.OS === "web") return readBrowserAdmission(signal);
  if (!nativeOrigin) return { enabled: false, session: null };
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) return { enabled: true, session: null };
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (bearer && bearer === deniedNativeBearer) {
    await clearNativeBearerIfCurrent(bearer, signal).catch(() => {});
    return { enabled: true, session: null };
  }
  if (bearer) {
    try {
      const current = await readDurableMerchant(bearer, signal);
      if (current.session.role === "merchant" &&
          await SecureStore.getItemAsync(storageKey, nativeOptions) === current.bearer &&
          !await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
        return { enabled: true, session: current.session };
      }
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
  if (Platform.OS === "web") return readBrowserStanding(signal);
  // Preserve the standing API's unauthenticated result for a missing or
  // quarantined bearer; the shared session guard below additionally verifies
  // the active Identity role and rejects stale Store readback.
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) {
    throw new MerchantStandingError(401, "UNAUTHENTICATED");
  }
  const initialBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!initialBearer || initialBearer === deniedNativeBearer) {
    throw new MerchantStandingError(401, "UNAUTHENTICATED");
  }
  // Store standing is not Identity authority. Refusal blocks the Store read,
  // but a fresh Identity check alone decides whether its credential is valid.
  return withNativeMerchantSession(signal, bearer =>
    readMerchantDSHStanding(nativeDSHOrigin ?? "", bearer, signal));
}

export async function withNativeMerchantSession<T>(signal: AbortSignal, run: (bearer: string, origin: string) => Promise<T>, actorId?: string,
  isWrite = false): Promise<T> {
  if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
  if (await clearPendingNativeAdmission(signal)) throw new IdentityClientError(401, "UNAUTHORIZED");
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer || bearer === deniedNativeBearer) throw new IdentityClientError(401, "UNAUTHORIZED");
  let effectiveBearer = bearer;
  try {
    const current = await readDurableMerchant(bearer, signal);
    effectiveBearer = current.bearer;
    const session = current.session;
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
  if (signal.aborted || bearer === deniedNativeBearer || afterIdentity !== effectiveBearer) {
    throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  }
  // A scoped 403 does not invalidate the Merchant's unrelated Store grants.
  const result = await run(effectiveBearer, nativeDSHOrigin ?? "");
  const afterOwner = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (signal.aborted || bearer === deniedNativeBearer || afterOwner !== effectiveBearer) {
    // A write may already have committed despite an account switch or abort.
    throw new DshPublicError(0, isWrite ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  }
  return result;
}


export async function requestAdmissionCode(phone: string, signal: AbortSignal): Promise<string> {
  if (Platform.OS === "web") return requestBrowserAdmissionCode(phone, signal);
  return issueCustomerPhoneChallenge(requireNativeOrigin(), phone, signal);
}

export async function submitAdmissionCode(
  ticket: string, code: string, signal: AbortSignal,
): Promise<VerifiedIdentitySession> {
  if (Platform.OS === "web") {
    return submitBrowserAdmissionCode(ticket, code, signal);
  }
  if (nativeAdmissionInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  nativeAdmissionInFlight = true;
  try {
    const origin = requireNativeOrigin();
    if (durableMerchantInFlight) await durableMerchantInFlight.catch(() => undefined);
    if (await clearPendingNativeAdmission(signal) &&
        await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
      throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
    }
    const previousBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (previousBearer && previousBearer !== deniedNativeBearer) {
      try {
        const active = await readDurableMerchant(previousBearer, signal);
        if (active.session.role === "merchant") throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
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
      const persistent = await establishPersistentIdentitySession(origin, bearer, signal);
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
        await SecureStore.setItemAsync(refreshStorageKey, persistent.refreshToken, nativeOptions);
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // Both credential writes must be acknowledged before accepting admission.
        // After acknowledged writes, uncertain marker deletion cannot
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
  if (Platform.OS === "web") return signOutBrowserAdmission(signal);
  const bearer = await mutateNativeStorage(async () => {
    const stored = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (stored) await SecureStore.setItemAsync(pendingStorageKey, "sign-out", nativeOptions);
    return stored;
  });
  if (!bearer) return;
  const refresh = await SecureStore.getItemAsync(refreshStorageKey, nativeOptions);
  if (refresh) {
    try { await revokePersistentIdentitySession(requireNativeOrigin(), refresh, signal); }
    catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
    }
  }
  try {
    await revokeVerifiedIdentitySession(requireNativeOrigin(), bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
  }
  await mutateNativeStorage(async () => {
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
    await SecureStore.deleteItemAsync(refreshStorageKey, nativeOptions);
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions);
  });
}
