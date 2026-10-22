import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  createManagedMobileIdentityBinding,
} from "@bthwani/identity";

export const role = "partner" as const;
export const surface = "app-partner" as const;
const namespace = "bthwani.partner";
const transientWebSession = new Map<string, string>();

const runtime = createManagedMobileIdentityBinding({
  role,
  surface,
  namespace,
  allowDevelopmentSessionFallback: Platform.OS !== "web" && process.env.EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF !== "1",
  // Browser compatibility proof only: keep tokens in memory, never localStorage.
  // A production web session must be implemented with a secure server-side session.
  secureStorage: Platform.OS === "web" ? {
    getItem: async (key) => transientWebSession.get(key) ?? null,
    setItem: async (key, value) => { transientWebSession.set(key, value); },
    removeItem: async (key) => { transientWebSession.delete(key); },
  } : {
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
export const logoutIdentity = runtime.logoutIdentity;
export const requestManagedActivation = runtime.requestManagedActivation;
export const requestManagedRecovery = runtime.requestManagedRecovery;
export const recoverManagedIdentity = runtime.recoverManagedIdentity;
export const activateManagedIdentity = runtime.activateManagedIdentity;
export const loginManagedIdentity = runtime.loginManagedIdentity;
