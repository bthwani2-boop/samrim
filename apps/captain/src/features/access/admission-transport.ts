import {
  admitCurrentCustomerAsCaptain,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  readPersistentIdentityRole,
  revokePersistentIdentitySession,
  resumeCurrentCustomerCaptainSession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { type CaptainStanding, CaptainStandingError, readApprovedCaptainStanding, readCaptainApplication, requestCaptainApplication } from "./captain-standing";

const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const key = process.env.EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani.captain.synthetic-admission.surface.v1" : "bthwani.captain.synthetic-admission.v1";
// A persisted bearer with uncertain delivery must stay quarantined after a
// JavaScript process restart, even when owner revocation and deletion fail.
const pendingKey = `${key}.pending.v1`;
const refreshKey = `${key}.refresh.v1`;
let nativeAdmissionInFlight = false;
let storageMutation: Promise<void> = Promise.resolve();
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageMutation.then(operation);
  storageMutation = result.then(() => undefined, () => undefined);
  return result;
}
const identityOrigin = process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN ?? "";
const dshOrigin = process.env.EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN ?? "";

function requireSyntheticOwner(): void {
  if (Platform.OS === "web" || !identityOrigin || !dshOrigin) {
    throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
  }
}

async function revokeUndelivered(bearer: string): Promise<void> {
  // Cleanup uses a fresh bounded deadline; the caller's aborted admission
  // signal cannot leave the UI busy indefinitely or skip revocation.
  const cleanup = new AbortController();
  const timeout = setTimeout(() => cleanup.abort(), 2000);
  try {
    await revokeVerifiedIdentitySession(identityOrigin, bearer, cleanup.signal)
      .catch(() => undefined);
  } finally {
    clearTimeout(timeout);
  }
}

async function reconcileCaptainAdmission(
  signal: AbortSignal, signOut = false, expectedActorId?: string,
): Promise<boolean> {
  return mutateNativeStorage(async () => {
    const pending = await SecureStore.getItemAsync(pendingKey, nativeOptions);
    if (!pending && !signOut) return false;
    const bearer = await SecureStore.getItemAsync(key, nativeOptions);
    if (!pending) {
      if (!bearer) return false;
      if (expectedActorId !== undefined) {
        try {
          const current = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
          if (current.role !== "captain" || current.actorId !== expectedActorId) {
            throw new IdentityClientError(409, "CAPTAIN_CONTEXT_CHANGED");
          }
        } catch (error) {
          // An already-revoked bearer can still be cleared from this device.
          if (!(error instanceof IdentityClientError && error.status === 401 && error.code === "UNAUTHORIZED")) throw error;
        }
      }
      // Quarantine the bearer until Identity confirms revocation. Deleting it
      // earlier would prevent recovery from an interrupted owner request.
      await SecureStore.setItemAsync(pendingKey, "sign-out", nativeOptions);
    }
    if (signal.aborted) {
      if (signOut) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      return true;
    }
    const refresh = await SecureStore.getItemAsync(refreshKey, nativeOptions);
    if (refresh) {
      try { await revokePersistentIdentitySession(identityOrigin, refresh, signal); }
      catch (error) {
        if (!(error instanceof IdentityClientError && error.status === 401)) {
          if (signOut) throw error;
          return true;
        }
      }
    }
    if (bearer && pending !== "owner-denied") {
      try {
        // Retry owner revocation after network recovery instead of merely
        // forgetting a sign-out or undelivered server-side credential.
        await revokeVerifiedIdentitySession(identityOrigin, bearer, signal);
      } catch (error) {
        if (!(error instanceof IdentityClientError && error.status === 401 && error.code === "UNAUTHORIZED")) {
          if (signOut) throw error;
          return true; // Keep durable quarantine for another retry.
        }
      }
    }
    if (bearer) {
      try {
        await SecureStore.deleteItemAsync(key, nativeOptions);
      } catch (error) {
        // Never remove the marker while bearer deletion is unconfirmed.
        if (signOut) throw error;
        return true;
      }
    }
    await SecureStore.deleteItemAsync(refreshKey, nativeOptions).catch(() => undefined);
    await SecureStore.deleteItemAsync(pendingKey, nativeOptions).catch(() => undefined);
    return true;
  });
}

let durableCaptainInFlight: Promise<Awaited<ReturnType<typeof readPersistentIdentityRole>>> | null = null;
async function readDurableCaptain(bearer: string, signal: AbortSignal) {
  if (durableCaptainInFlight) return durableCaptainInFlight;
  const pending = (async () => {
  const refresh = await SecureStore.getItemAsync(refreshKey, nativeOptions);
  return readPersistentIdentityRole(identityOrigin, bearer, refresh, "captain", signal,
    () => mutateNativeStorage(async () => {
      if (signal.aborted || await SecureStore.getItemAsync(pendingKey, nativeOptions) ||
          await SecureStore.getItemAsync(key, nativeOptions) !== bearer) {
        throw new IdentityClientError(0, "OWNER_RESPONSE_STALE");
      }
      await SecureStore.setItemAsync(pendingKey, "refreshing", nativeOptions);
    }),
    (issued, before, rotated) => mutateNativeStorage(async () => {
      const pending = await SecureStore.getItemAsync(pendingKey, nativeOptions);
      if (signal.aborted || await SecureStore.getItemAsync(key, nativeOptions) !== before ||
          (pending && (!rotated || pending !== "refreshing"))) return false;
      await SecureStore.setItemAsync(refreshKey, issued.refreshToken, nativeOptions);
      if (rotated) {
        await SecureStore.setItemAsync(key, issued.accessToken, nativeOptions);
        await SecureStore.deleteItemAsync(pendingKey, nativeOptions);
      }
      return true;
    }));
  })();
  durableCaptainInFlight = pending;
  try { return await pending; }
  finally { if (durableCaptainInFlight === pending) durableCaptainInFlight = null; }
}

export type CaptainAdmissionState = Readonly<{
  enabled: boolean;
  standingReady: boolean;
  session: VerifiedIdentitySession | null;
  standing?: CaptainStanding;
}>;

export async function readCaptainAdmission(signal: AbortSignal): Promise<CaptainAdmissionState> {
  if (Platform.OS === "web" || !identityOrigin) {
    return { enabled: false, standingReady: false, session: null };
  }
  // Identity may serve the public form before DSH enables Captain standing.
  // No stored bearer is read, admitted or exposed without both owners.
  if (!dshOrigin) {
    return { enabled: true, standingReady: false, session: null };
  }
  if (durableCaptainInFlight) await durableCaptainInFlight.catch(() => undefined);
  if (nativeAdmissionInFlight || await reconcileCaptainAdmission(signal)) {
    return { enabled: true, standingReady: true, session: null };
  }
  const bearer = await SecureStore.getItemAsync(key, nativeOptions);
  if (!bearer) return { enabled: true, standingReady: true, session: null };
  try {
    const current = await readDurableCaptain(bearer, signal);
    const session = current.session;
    if (session.role !== "captain") throw new IdentityClientError(401, "UNAUTHORIZED");
    const standing = await readApprovedCaptainStanding(dshOrigin, current.bearer, "captain", session.actorId, signal);
    // Both owner replies may finish AFTER a concurrent sign-out or actor
    // switch. Only the credential still owned by this device can be rendered.
    const stillCurrent = await mutateNativeStorage(async () =>
      !signal.aborted &&
      !await SecureStore.getItemAsync(pendingKey, nativeOptions) &&
      await SecureStore.getItemAsync(key, nativeOptions) === current.bearer
    );
    return { enabled: true, standingReady: true, session: stillCurrent ? session : null, ...(stillCurrent ? { standing } : {}) };
  } catch (error) {
    // Network uncertainty must not be represented as a signed-out or approved actor.
    const invalid = (error instanceof IdentityClientError && error.status === 401) ||
      (error instanceof CaptainStandingError && [401, 403].includes(error.status));
    if (invalid && !signal.aborted) {
      await mutateNativeStorage(async () => {
        // An old actor's 401 must never quarantine a newer bearer installed
        // while its owner request was in flight.
        if (await SecureStore.getItemAsync(key, nativeOptions) !== bearer) return;
        // A revoked bearer cannot reappear after a failed device deletion.
        await SecureStore.setItemAsync(pendingKey, "owner-denied", nativeOptions);
        if (await SecureStore.getItemAsync(key, nativeOptions) === bearer) {
          await SecureStore.deleteItemAsync(key, nativeOptions).catch(() => undefined);
          await SecureStore.deleteItemAsync(refreshKey, nativeOptions).catch(() => undefined);
        }
        if (!await SecureStore.getItemAsync(key, nativeOptions)) {
          await SecureStore.deleteItemAsync(pendingKey, nativeOptions).catch(() => undefined);
        }
      });
      return { enabled: true, standingReady: true, session: null };
    }
    throw error;
  }
}

export async function requestCaptainPhoneCode(phone: string, signal: AbortSignal): Promise<string> {
  requireSyntheticOwner();
  return issueCustomerPhoneChallenge(identityOrigin, phone, signal);
}

export type CaptainVerifiedResult = Readonly<
  | { state: "pending" }
  | { state: "approved"; session: VerifiedIdentitySession }
>;

export async function verifyCaptainCode(
  ticket: string, code: string, signal: AbortSignal,
): Promise<CaptainVerifiedResult> {
  requireSyntheticOwner();
  if (nativeAdmissionInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  nativeAdmissionInFlight = true;
  try {
    // A previous issued bearer or an unresolved device write must never be
    // replaced by another phone proof. Check before consuming that proof.
    if (durableCaptainInFlight) await durableCaptainInFlight.catch(() => undefined);
    if (await reconcileCaptainAdmission(signal) ||
        await SecureStore.getItemAsync(key, nativeOptions)) {
      throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
    }
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    const customerIssued = await verifyCustomerPhoneChallenge(identityOrigin, ticket, code, signal);
    let captainBearer: string | null = null;
  try {
    const customer = await readVerifiedIdentitySession(identityOrigin, customerIssued.accessToken, signal);
    if (customer.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    try {
      await readApprovedCaptainStanding(dshOrigin, customerIssued.accessToken, "customer", customer.actorId, signal);
    } catch (error) {
      if (!(error instanceof CaptainStandingError && error.code === "CAPTAIN_NOT_ELIGIBLE")) throw error;
      let standing: "PENDING" | "APPROVED";
      try {
        standing = await requestCaptainApplication(dshOrigin, customerIssued.accessToken, customer.actorId, signal);
      } catch (applicationError) {
        if (!(applicationError instanceof CaptainStandingError) ||
          applicationError.code !== "OPERATION_RESULT_UNKNOWN" || signal.aborted) throw applicationError;
        // Do not retry a possibly committed POST. Read DSH's current record
        // for the *verified Customer actor* once through the same bearer.
        try {
          standing = await readCaptainApplication(dshOrigin, customerIssued.accessToken, customer.actorId, signal);
        } catch (readError) {
          // A current owner-confirmed suspension takes precedence over an
          // uncertain POST. Anything else remains an unresolved write outcome.
          if (readError instanceof CaptainStandingError && readError.code === "CAPTAIN_NOT_ELIGIBLE") throw readError;
          throw applicationError;
        }
      }
      if (standing === "PENDING") return { state: "pending" };
    }
    const issued = await admitCurrentCustomerAsCaptain(identityOrigin, customerIssued.accessToken, signal)
      .catch((error: unknown) => {
        if (error instanceof IdentityClientError &&
          ["ALREADY_PROVISIONED", "OPERATION_RESULT_UNKNOWN"].includes(error.code) && !signal.aborted) {
          return resumeCurrentCustomerCaptainSession(identityOrigin, customerIssued.accessToken, signal);
        }
        throw error;
      });
    captainBearer = issued.accessToken;
    const captain = await readVerifiedIdentitySession(identityOrigin, captainBearer, signal);
    if (captain.role !== "captain" || captain.actorId !== customer.actorId) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    await readApprovedCaptainStanding(dshOrigin, captainBearer, "captain", captain.actorId, signal);
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    const issuedBearer = captainBearer;
    await mutateNativeStorage(async () => {
      if (signal.aborted || await SecureStore.getItemAsync(key, nativeOptions)) {
        throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      }
      // The marker is committed BEFORE the token. Failed acknowledgments or
      // failed revocation leave it readable after process restart.
      await SecureStore.setItemAsync(pendingKey, "in-flight", nativeOptions);
      await SecureStore.setItemAsync(key, issuedBearer, nativeOptions);
      if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      // A successful token write is the admission commit point. If marker
      // deletion succeeds on-device but throws, returning failure would leave
      // an undelivered live token with no marker. Treat cleanup as uncertain.
      await SecureStore.deleteItemAsync(pendingKey, nativeOptions).catch(() => undefined);
    });
    captainBearer = null;
    return { state: "approved", session: captain };
  } catch (error) {
    if (captainBearer !== null) {
      const undelivered = captainBearer;
      await mutateNativeStorage(async () => {
        if (await SecureStore.getItemAsync(key, nativeOptions) === undelivered) {
          await SecureStore.deleteItemAsync(key, nativeOptions);
        }
      }).catch(() => undefined);
      await revokeUndelivered(undelivered);
    }
    // The temporary Customer proof was consumed before this downstream
    // failure. A retry with the same ticket can never work. Preserve the
    // distinction from an incorrect code (which fails before issuance).
    if (signal.aborted) throw error;
    // DSH may have committed a pending application before the POST reply was
    // lost. Keep that unknown result distinct from a consumed phone challenge;
    // the ephemeral Customer bearer is revoked below and there is no blind retry.
    // A confirmed suspension likewise cannot be overridden by a new phone proof.
    if (error instanceof CaptainStandingError &&
      ["CAPTAIN_NOT_ELIGIBLE", "OPERATION_RESULT_UNKNOWN"].includes(error.code)) {
      throw error;
    }
    throw new IdentityClientError(0, "PHONE_CHALLENGE_CONSUMED");
  } finally {
    // A temporary Customer token is never held in Captain application storage.
    await revokeUndelivered(customerIssued.accessToken);
  }
  } finally {
    nativeAdmissionInFlight = false;
  }
}

export async function leaveCaptainAdmission(signal: AbortSignal, expectedActorId?: string): Promise<void> {
  requireSyntheticOwner();
  if (nativeAdmissionInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  await reconcileCaptainAdmission(signal, true, expectedActorId);
}
