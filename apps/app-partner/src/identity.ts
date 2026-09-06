import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createMobileIdentityRuntime,
  type IdentityClient,
  type IdentitySessionState,
} from "@bthwani/identity";

const role = "partner" as const;
const surface = "app-partner" as const;
const namespace = "bthwani.partner";

const runtime = createMobileIdentityRuntime({
  role,
  surface,
  namespace,
  secureStorage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  cryptoRandomUUID: () => Crypto.randomUUID(),
  getExpoHostUri: () => (Constants.expoConfig as { hostUri?: string } | null)?.hostUri,
  explicitApiUrl: process.env.EXPO_PUBLIC_IDENTITY_API_URL,
});

export const restoreIdentitySession = runtime.restoreIdentitySession;
export const currentIdentityState = runtime.currentIdentityState;
export const logoutIdentity = runtime.logoutIdentity;

export function requestManagedActivation(phone: string) {
  return runtime.identityClient().requestManagedActivation({ phone, role });
}

export async function activateManagedIdentity(phone: string, verificationCode: string, password: string): Promise<IdentitySessionState> {
  const pair = await runtime.identityClient().activateManaged({
    phone,
    role,
    verificationCode,
    password,
    deviceFingerprint: await runtime.deviceFingerprint(),
  });
  return runtime.identitySession().adopt(pair);
}

export async function loginManagedIdentity(phone: string, password: string): Promise<IdentitySessionState> {
  const pair = await runtime.identityClient().loginManaged({
    phone,
    role,
    password,
    deviceFingerprint: await runtime.deviceFingerprint(),
  });
  return runtime.identitySession().adopt(pair);
}

export function requestManagedRecovery(phone: string) {
  return runtime.identityClient().requestManagedRecovery({ phone, role });
}

export async function recoverManagedIdentity(phone: string, code: string, password: string): Promise<IdentitySessionState> {
  await runtime.identityClient().recoverManaged({ phone, role, code, password });
  return { kind: "signed_out" };
}
