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
const storageKey = "bthwani.customer.synthetic-identity.v1";
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type State = { enabled: boolean; session: VerifiedIdentitySession | null };

let nativeMutation: Promise<void> = Promise.resolve();
let invalidNativeBearer: string | null = null;
function mutateNativeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const outcome = nativeMutation.then(operation);
  nativeMutation = outcome.then(() => undefined, () => undefined);
  return outcome;
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
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) return { enabled: true, session: null };
  if (bearer === invalidNativeBearer) {
    await clearStoredBearerIfCurrent(bearer, signal).catch(() => {});
    return { enabled: true, session: null };
  }
  try {
    const session = await readVerifiedIdentitySession(nativeOrigin, bearer, signal);
    if (session.role === "customer") return { enabled: true, session };
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
  const origin = requiredNativeOrigin();
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
  const issued = await verifyCustomerPhoneChallenge(origin, ticket, code, signal);
  try {
    const session = await readVerifiedIdentitySession(origin, issued.accessToken, signal);
    if (signal.aborted || session.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    await mutateNativeStorage(async () => {
      if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      const current = await SecureStore.getItemAsync(storageKey, nativeOptions);
      if (current && current !== previousBearer) throw new IdentityClientError(409, "SIGN_OUT_REQUIRED");
      await SecureStore.setItemAsync(storageKey, issued.accessToken, nativeOptions);
      if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
      invalidNativeBearer = null;
    });
    if (signal.aborted) throw new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
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
}

export async function signOutCustomer(signal: AbortSignal): Promise<void> {
  if (Platform.OS === "web") return webRequest<void>("DELETE", signal);
  const bearer = await SecureStore.getItemAsync(storageKey, nativeOptions);
  if (!bearer) return;
  if (bearer === invalidNativeBearer) {
    await clearStoredBearerIfCurrent(bearer, signal);
    return;
  }
  try {
    const session = await readVerifiedIdentitySession(requiredNativeOrigin(), bearer, signal);
    if (session.role === "customer") await revokeVerifiedIdentitySession(requiredNativeOrigin(), bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError && (error.status === 401 || error.status === 403))) throw error;
  }
  invalidNativeBearer = bearer;
  await clearStoredBearerIfCurrent(bearer, signal);
}
