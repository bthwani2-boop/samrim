import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createManagedMobileIdentityBinding,
} from "@bthwani/identity";

export const role = "field" as const;
export const surface = "app-field" as const;
const namespace = "bthwani.field";

const runtime = createManagedMobileIdentityBinding({
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
export const requestManagedActivation = runtime.requestManagedActivation;
export const activateManagedIdentity = runtime.activateManagedIdentity;
export const loginManagedIdentity = runtime.loginManagedIdentity;
export const requestManagedRecovery = runtime.requestManagedRecovery;
export const recoverManagedIdentity = runtime.recoverManagedIdentity;
