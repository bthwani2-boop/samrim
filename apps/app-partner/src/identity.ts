import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createManagedMobileIdentityBinding,
} from "@bthwani/identity";

export const role = "partner" as const;
export const surface = "app-partner" as const;
const namespace = "bthwani.partner";

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
  explicitApiUrl: process.env.EXPO_PUBLIC_IDENTITY_API_URL,
});

export const restoreIdentitySession = runtime.restoreIdentitySession;
export const currentIdentityState = runtime.currentIdentityState;
export const readIdentityAccessToken = runtime.readAccessToken;
export const logoutIdentity = runtime.logoutIdentity;
export const requestManagedActivation = runtime.requestManagedActivation;
export const activateManagedIdentity = runtime.activateManagedIdentity;
export const loginManagedIdentity = runtime.loginManagedIdentity;
export const requestManagedRecovery = runtime.requestManagedRecovery;
export const recoverManagedIdentity = runtime.recoverManagedIdentity;
