import {
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  revokeVerifiedIdentitySession,
  type VerifiedIdentitySession,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { verifyMerchantAdmission } from "./admission";

const storageKey = "bthwani.merchant.synthetic-admission.v1";
const nativeOrigin = process.env.EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
type EntryState = { enabled: boolean; session: VerifiedIdentitySession | null };

async function webRequest<T>(method: string, signal: AbortSignal, data?: object): Promise<T> {
  const result = await fetch("/api/admission", {
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
  if (bearer) {
    try {
      const session = await readVerifiedIdentitySession(nativeOrigin, bearer, signal);
      if (session.role === "merchant") return { enabled: true, session };
    } catch (error) {
      if (!(error instanceof IdentityClientError && error.status === 401)) throw error;
    }
    if (!signal.aborted) await SecureStore.deleteItemAsync(storageKey, nativeOptions);
  }
  return { enabled: true, session: null };
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
    await SecureStore.setItemAsync(storageKey, bearer, nativeOptions);
    return session;
  } catch (error) {
    await revokeVerifiedIdentitySession(origin, bearer).catch(() => undefined);
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
  await SecureStore.deleteItemAsync(storageKey, nativeOptions);
}
