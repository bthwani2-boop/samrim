import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createMobileIdentityRuntime,
  type IdentityClient,
  type IdentitySessionState,
} from "@bthwani/identity";

const role = "client" as const;
const surface = "app-client" as const;
const namespace = "bthwani.client";

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

export function requestClientRegistration(phone: string) {
  return runtime.identityClient().requestClientRegistration({ phone });
}

export async function registerClient(phone: string, code: string, password: string): Promise<IdentitySessionState> {
  const pair = await runtime.identityClient().registerClient({
    phone,
    code,
    password,
    deviceFingerprint: await runtime.deviceFingerprint(),
  });
  return runtime.identitySession().adopt(pair);
}

export async function loginClient(phone: string, password: string): Promise<IdentitySessionState> {
  const pair = await runtime.identityClient().loginClient({
    phone,
    password,
    deviceFingerprint: await runtime.deviceFingerprint(),
  });
  return runtime.identitySession().adopt(pair);
}

export function requestClientRecovery(phone: string) {
  return runtime.identityClient().requestClientRecovery({ phone });
}

export async function recoverClient(phone: string, code: string, password: string): Promise<IdentitySessionState> {
  const pair = await runtime.identityClient().recoverClient({
    phone,
    code,
    password,
    deviceFingerprint: await runtime.deviceFingerprint(),
  });
  return runtime.identitySession().adopt(pair);
}
