import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const nativeOrigin = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN;
const storageKey = process.env.EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani.customer.synthetic-identity.surface.v1" : "bthwani.customer.synthetic-identity.v1";
// Survives a process restart when a device write cannot be confirmed or undone.
const pendingStorageKey = `${storageKey}.pending.v1`;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type State = { enabled: boolean; session: VerifiedIdentitySession | null };

let nativeMutation: Promise<void> = Promise.resolve();
let invalidNativeBearer: string | null = null;
let nativeVerificationInFlight = false;
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const outcome = nativeMutation.then(operation);
  nativeMutation = outcome.then(() => undefined, () => undefined);
  return outcome;
}
async function clearPendingCustomerAdmission(signal: AbortSignal): Promise<boolean> {
  return mutateNativeStorage(async () => {
    if (!await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) return false;
    if (signal.aborted) return true;
    const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (bearer) {
      invalidNativeBearer = bearer;
      try {
        await SecureStore.deleteItemAsync(storageKey, nativeOptions);
      } catch {
        return true;
      }
    }
    await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
    return true;
  });
}

async function clearStoredBearerIfCurrent(bearer: string, signal: AbortSignal) {
  await mutateNativeStorage(async () => {
    if (signal.aborted) return;
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) !== bearer || signal.aborted) return;
    await SecureStore.deleteItemAsync(storageKey, nativeOptions);
  });
}

async function webRequest<T>(method: "GET" | "POST" | "DELETE", signal: AbortSignal, data?: object): Promise<T> {
  const response = await fetch("/api/customer-auth", {
    method, signal, credentials: "same-origin", cache: "no-store",
    ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new IdentityClientError(response.status, body.code);
  return body as T;
}

function requiredNativeOrigin(): string {
  if (!nativeOrigin) throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
  return nativeOrigin;
}

export async function readCustomerAdmission(signal: AbortSignal): Promise<State> {
  if (Platform.OS === "web") {
    try {
      return await webRequest<State>("GET", signal);
    } catch (error) {
      if (error instanceof IdentityClientError && (error.status === 401 || error.status === 403)) {
        return { enabled: true, session: null };
      }
      throw error;
    }
  }
  if (!nativeOrigin) return { enabled: false, session: null };
  if (await clearPendingCustomerAdmission(signal)) return { enabled: true, session: null };
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) return { enabled: true, session: null };
  if (bearer === invalidNativeBearer) {
    await clearStoredBearerIfCurrent(bearer, signal).catch(() => {});
    return { enabled: true, session: null };
  }
  try {
    const session = await readVerifiedIdentitySession(nativeOrigin, bearer, signal);
    if (session.role === "customer") {
      // A verified old response is not authority to resurrect an actor after
      // sign-out, token rotation or the start of a pending device cleanup.
      const stillCurrent = await mutateNativeStorage(async () =>
        !signal.aborted && bearer !== invalidNativeBearer &&
        !await SecureStore.getItemAsync(pendingStorageKey, nativeOptions) &&
        await SecureStore.getItemAsync(storageKey, nativeOptions) === bearer
      );
      return { enabled: true, session: stillCurrent ? session : null };
    }
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
  }
  if (!signal.aborted) {
    invalidNativeBearer = bearer;
    await clearStoredBearerIfCurrent(bearer, signal).catch(() => {});
  }
  return { enabled: true, session: null };
}

export async function requestCustomerCode(phone: string, signal: AbortSignal) {
  if (Platform.OS === "web") return (await webRequest<{ticket: string}>("POST", signal, { phone })).ticket;
  return issueCustomerPhoneChallenge(requiredNativeOrigin(), phone, signal);
}

async function revokeUnusableCustomerBearer(origin: string, bearer: string) {
  await revokeVerifiedIdentitySession(origin, bearer, AbortSignal.timeout(2000)).catch(() => undefined);
}

export async function verifyCustomerCode(ticket: string, code: string, signal: AbortSignal) {
  if (Platform.OS === "web") {
    return (await webRequest<{session: VerifiedIdentitySession}>("POST", signal, { ticket, code })).session;
  }
  if (nativeVerificationInFlight) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
  nativeVerificationInFlight = true;
  try {
    const origin = requiredNativeOrigin();
    if (await clearPendingCustomerAdmission(signal) &&
        await SecureStore.getItemAsync(pendingStorageKey, nativeOptions)) {
      throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
    }
    const previousBearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
    if (previousBearer && previousBearer !== invalidNativeBearer) {
      try {
        const active = await readVerifiedIdentitySession(origin, previousBearer, signal);
        if (active.role === "customer") throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
        invalidNativeBearer = previousBearer;
        await clearStoredBearerIfCurrent(previousBearer, signal).catch(() => {});
      } catch (error) {
        if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
          throw error;
        }
        invalidNativeBearer = previousBearer;
        await clearStoredBearerIfCurrent(previousBearer, signal).catch(() => {});
      }
    }
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    const issued = await verifyCustomerPhoneChallenge(origin, ticket, code, signal);
    try {
      const session = await readVerifiedIdentitySession(origin, issued.accessToken, signal);
      if (signal.aborted || session.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
      await mutateNativeStorage(async () => {
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        const current = await SecureStore.getItemAsync(storageKey, nativeOptions);
        if (current && current !== previousBearer) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
        await SecureStore.setItemAsync(pendingStorageKey, "in-flight", nativeOptions);
        await SecureStore.setItemAsync(storageKey, issued.accessToken, nativeOptions);
        if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
        // Native commit point: the issued credential write was acknowledged.
        // After an acknowledged bearer write, uncertain marker deletion cannot
        // turn a committed token into an undelivered error. If it remains, the
        // next cold-start read will still reject the bearer until cleanup.
        await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => {});
        invalidNativeBearer = null;
      });
      return session;
    } catch (error) {
      // The device may have written the bearer before reporting cancellation or
      // a storage error. Never let that undelivered credential reappear on resume.
      invalidNativeBearer = issued.accessToken;
      await mutateNativeStorage(async () => {
        if (await SecureStore.getItemAsync(storageKey, nativeOptions) === issued.accessToken) {
          await SecureStore.deleteItemAsync(storageKey, nativeOptions);
        }
      }).catch(() => {});
      await revokeUnusableCustomerBearer(origin, issued.accessToken);
      throw error;
    }
  } finally {
    nativeVerificationInFlight = false;
  }
}

export async function signOutCustomer(signal: AbortSignal): Promise<void> {
  if (Platform.OS === "web") return webRequest<void>("DELETE", signal);
  let bearer: string | null = null;
  let previouslyInvalid = false;
  try {
    await mutateNativeStorage(async () => {
      bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
      if (!bearer) return;
      previouslyInvalid = bearer === invalidNativeBearer;
      // Persist quarantine BEFORE any owner network operation. A missing
      // response or failed device deletion must never restore the old actor.
      invalidNativeBearer = bearer;
      await SecureStore.setItemAsync(pendingStorageKey, "sign-out", nativeOptions);
    });
  } catch (error) {
    // If the marker itself could not be committed, deleting the old token is
    // still safer than leaving a known-active bearer on this device.
    if (bearer) {
      await mutateNativeStorage(async () => {
        if (await SecureStore.getItemAsync(storageKey, nativeOptions) === bearer) {
          await SecureStore.deleteItemAsync(storageKey, nativeOptions);
        }
      }).catch(() => undefined);
    }
    throw error;
  }
  if (!bearer) return;
  let ownerFailure: unknown;
  try {
    if (!previouslyInvalid) {
      const session = await readVerifiedIdentitySession(requiredNativeOrigin(), bearer, signal);
      if (session.role === "customer") {
        await revokeVerifiedIdentitySession(requiredNativeOrigin(), bearer, signal);
      }
    }
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) {
      ownerFailure = error;
    }
  }
  // Local logout must complete even when the owner cannot confirm revocation.
  // The marker remains if device deletion fails and protects a cold start.
  await mutateNativeStorage(async () => {
    if (await SecureStore.getItemAsync(storageKey, nativeOptions) === bearer) {
      await SecureStore.deleteItemAsync(storageKey, nativeOptions);
    }
    if (!await SecureStore.getItemAsync(storageKey, nativeOptions)) {
      await SecureStore.deleteItemAsync(pendingStorageKey, nativeOptions).catch(() => undefined);
    }
  });
  if (ownerFailure !== undefined) throw ownerFailure;
}
