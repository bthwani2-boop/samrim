import {
  createManagedMobileIdentityBinding,
} from "@bthwani/identity";
import { unregisterOwnPushDevice } from "@bthwani/push-device";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import * as SecureStore from "./compatible-storage";

export const role = "partner" as const;
export const surface = "app-partner" as const;
const namespace = "bthwani.partner";

const runtime = createManagedMobileIdentityBinding({
  role,
  surface,
  namespace,
  allowDevelopmentSessionFallback: Platform.OS !== "web" && process.env.EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF !== "1",
  // Platform storage preserves native keychain and keeps browser tokens in memory.
  secureStorage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  cryptoRandomUUID: () => Crypto.randomUUID(),
  explicitApiUrl: process.env.EXPO_PUBLIC_IDENTITY_API_URL,
});

export const restoreIdentitySession = runtime.restoreIdentitySession;
export const currentIdentityState = runtime.currentIdentityState;
export const getUsableIdentityAccessToken = runtime.getUsableAccessToken;
export const subscribeIdentitySession = runtime.subscribeIdentityState;
export async function logoutIdentity() {
  try {
    const token = await runtime.getUsableAccessToken();
    await unregisterOwnPushDevice(token, process.env.EXPO_PUBLIC_DSH_API_URL);
  } catch { /* Preserve logout even if deregistration is offline. */ }
  return runtime.logoutIdentity();
}
export const requestManagedActivation = runtime.requestManagedActivation;
export const requestManagedRecovery = runtime.requestManagedRecovery;
export const recoverManagedIdentity = runtime.recoverManagedIdentity;
export const activateManagedIdentity = runtime.activateManagedIdentity;
export const loginManagedIdentity = runtime.loginManagedIdentity;
