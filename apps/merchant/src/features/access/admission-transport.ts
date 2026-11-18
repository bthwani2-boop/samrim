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

const storageKey = "bthwani.merchant.synthetic-admission.v1";
const nativeOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
const nativeDSHOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type EntryState = { enabled: boolean; session: VerifiedIdentitySession | null };

// Serialize app-local SecureStore mutations so late owner responses cannot erase
// a newer sign-in written while the old request was in flight.
let nativeStorageMutation: Promise<void> = Promise.resolve();
let deniedNativeBearer: string | null = null;
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeStorageMutation.then(operation);
  nativeStorageMutation = result.then(() => undefined, () => undefined);
  return result;
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
      if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
    }
    await clearNativeBearerIfCurrent(bearer, signal);
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
  const origin = requireNativeOrigin();
  const { session, bearer } = await verifyMerchantAdmission(origin, ticket, code, signal);
  try {
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
    await mutateNativeStorage(() => SecureStore.setItemAsync(storageKey, bearer, nativeOptions));
    return session;
  } catch (error) {
    await revokeUndeliveredAdmissionSession(origin, bearer);
    throw error;
  }
}

export async function signOutOfAdmission(signal: AbortSignal): Promise<void> {
  if (Platform.OS === "web") return webRequest("DELETE", signal);
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) return;
  try {
    await revokeVerifiedIdentitySession(requireNativeOrigin(), bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
  }
  await clearNativeBearerIfCurrent(bearer, signal);
}
