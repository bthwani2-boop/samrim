import {
  admitCurrentCustomerAsCaptain,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  resumeCurrentCustomerCaptainSession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { CaptainStandingError, readApprovedCaptainStanding, requestCaptainApplication } from "./captain-standing";

const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const key = "bthwani.captain.synthetic-admission.v1";
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

export type CaptainAdmissionState = Readonly<{
  enabled: boolean;
  session: VerifiedIdentitySession | null;
}>;

export async function readCaptainAdmission(signal: AbortSignal): Promise<CaptainAdmissionState> {
  if (Platform.OS === "web" || !identityOrigin || !dshOrigin) {
    return { enabled: false, session: null };
  }
  const bearer = await SecureStore.getItemAsync(key, nativeOptions);
  if (!bearer) return { enabled: true, session: null };
  try {
    const session = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
    if (session.role !== "captain") throw new IdentityClientError(401, "UNAUTHORIZED");
    await readApprovedCaptainStanding(dshOrigin, bearer, "captain", session.actorId, signal);
    return { enabled: true, session };
  } catch (error) {
    // Network uncertainty must not be represented as a signed-out or approved actor.
    const invalid = (error instanceof IdentityClientError && error.status === 401) ||
      (error instanceof CaptainStandingError && [401, 403].includes(error.status));
    if (invalid && !signal.aborted) {
      await SecureStore.deleteItemAsync(key, nativeOptions);
      return { enabled: true, session: null };
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
  const customerIssued = await verifyCustomerPhoneChallenge(identityOrigin, ticket, code, signal);
  let captainBearer: string | null = null;
  try {
    const customer = await readVerifiedIdentitySession(identityOrigin, customerIssued.accessToken, signal);
    if (customer.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    try {
      await readApprovedCaptainStanding(dshOrigin, customerIssued.accessToken, "customer", customer.actorId, signal);
    } catch (error) {
      if (!(error instanceof CaptainStandingError && error.code === "CAPTAIN_NOT_ELIGIBLE")) throw error;
      const standing = await requestCaptainApplication(dshOrigin, customerIssued.accessToken, customer.actorId, signal);
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
    await SecureStore.setItemAsync(key, captainBearer, nativeOptions);
    captainBearer = null;
    return { state: "approved", session: captain };
  } catch (error) {
    if (captainBearer !== null) await revokeUndelivered(captainBearer);
    // The temporary Customer proof was consumed before this downstream
    // failure. A retry with the same ticket can never work. Preserve the
    // distinction from an incorrect code (which fails before issuance).
    if (signal.aborted) throw error;
    // A DSH owner-confirmed suspension is not a phone-code error. The temporary
    // Customer session is still revoked below; never suggest retrying admission
    // as if a fresh proof could override suspended or revoked Captain standing.
    if (error instanceof CaptainStandingError && error.code === "CAPTAIN_NOT_ELIGIBLE") {
      throw error;
    }
    throw new IdentityClientError(0, "PHONE_CHALLENGE_CONSUMED");
  } finally {
    // A temporary Customer token is never held in Captain application storage.
    await revokeUndelivered(customerIssued.accessToken);
  }
}

export async function leaveCaptainAdmission(signal: AbortSignal): Promise<void> {
  requireSyntheticOwner();
  const bearer = await SecureStore.getItemAsync(key, nativeOptions);
  if (!bearer) return;
  try {
    await revokeVerifiedIdentitySession(identityOrigin, bearer, signal);
  } finally {
    // The device does not retain the bearer after logout, including if remote
    // revocation has an unknown outcome; the caller must report that error.
    await SecureStore.deleteItemAsync(key, nativeOptions);
  }
}
