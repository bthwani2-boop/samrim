import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createIdentityClient,
  IdentitySessionManager,
  type IdentityClient,
  type IdentitySessionState,
} from "@bthwani/identity";

const role = "field" as const;
const surface = "app-field" as const;
const namespace = "bthwani.field";
const deviceKey = namespace + ".identity.device.v1";

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

let clientValue: IdentityClient | null = null;
let sessionValue: IdentitySessionManager | null = null;

function configuredEnvironmentUrl(): string | undefined {
  const value = process.env.EXPO_PUBLIC_IDENTITY_API_URL?.trim();
  return value || undefined;
}

function developmentHostUrl(): string | undefined {
  const expoConfig = Constants.expoConfig as (typeof Constants.expoConfig & { hostUri?: string }) | null;
  const raw = expoConfig?.hostUri?.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/^[a-z]+:\/\//i, "");
  const host = normalized.startsWith("[") ? normalized.slice(0, normalized.indexOf("]") + 1) : normalized.split(":")[0];
  return host ? "http://" + host + ":18082" : undefined;
}

function identityBaseUrl(): string {
  const explicit = configuredEnvironmentUrl();
  if (explicit) return explicit;
  const development = developmentHostUrl();
  if (development) return development;
  throw new Error("IDENTITY_BASE_URL_UNAVAILABLE");
}

async function deviceFingerprint(): Promise<string> {
  const existing = (await SecureStore.getItemAsync(deviceKey))?.trim();
  if (existing && existing.length >= 8) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(deviceKey, created);
  return created;
}

function identityClient(): IdentityClient {
  clientValue ??= createIdentityClient(identityBaseUrl());
  return clientValue;
}

function identitySession(): IdentitySessionManager {
  sessionValue ??= new IdentitySessionManager(identityClient(), secureStorage, deviceFingerprint, role, surface, namespace);
  return sessionValue;
}

export function restoreIdentitySession(): Promise<IdentitySessionState> {
  return identitySession().restore();
}

export function requestManagedActivation(phone: string) {
  return identityClient().requestManagedActivation({ phone, role });
}

export async function activateManagedIdentity(phone: string, code: string): Promise<IdentitySessionState> {
  const pair = await identityClient().activateManaged({
    phone,
    role,
    code,
    deviceFingerprint: await deviceFingerprint(),
  });
  return identitySession().adopt(pair);
}

export function logoutIdentity(): Promise<void> {
  return identitySession().logout();
}

export function currentIdentityState(): IdentitySessionState {
  return identitySession().state;
}
