declare const process: { env: Record<string, string | undefined> };

import type { IdentityClient } from "./client";
import { createIdentityClient } from "./client";
import type { ActorType } from "./generated/identity-types";
import type { IdentitySessionState, IdentitySurface } from "./session";
import { IdentitySessionManager } from "./session";
import { validateServiceUrl } from "./url";

export type MobileIdentityRuntimeConfig = {
  role: ActorType;
  surface: IdentitySurface;
  namespace: string;
  defaultDevPort?: number | undefined;
  secureStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  cryptoRandomUUID: () => string;
  getExpoHostUri?: (() => string | undefined) | undefined;
  explicitApiUrl?: string | undefined;
};

export function createMobileIdentityRuntime(config: MobileIdentityRuntimeConfig) {
  const deviceKey = `${config.namespace}.identity.device.v1`;
  let clientValue: IdentityClient | null = null;
  let sessionValue: IdentitySessionManager | null = null;

  function configuredEnvironmentUrl(): string | undefined {
    const value = config.explicitApiUrl?.trim();
    if (!value) return undefined;
    if (process.env.NODE_ENV === "development" && /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::|\/|$)/i.test(value)) return undefined;
    return value;
  }

  function developmentHostUrl(): string | undefined {
    const raw = config.getExpoHostUri?.()?.trim();
    if (!raw) return undefined;
    const normalized = raw.replace(/^[a-z]+:\/\//i, "");
    const host = normalized.startsWith("[") ? normalized.slice(0, normalized.indexOf("]") + 1) : normalized.split(":")[0];
    const port = config.defaultDevPort ?? 18082;
    return host ? `http://${host}:${port}` : undefined;
  }

  function identityBaseUrl(): string {
    const explicit = configuredEnvironmentUrl();
    if (explicit) {
      return validateServiceUrl(explicit, "IDENTITY_BASE_URL");
    }
    if (process.env.NODE_ENV !== "development") throw new Error("IDENTITY_BASE_URL_REQUIRED_IN_PRODUCTION");
    const development = developmentHostUrl();
    if (development) return development;
    throw new Error("IDENTITY_BASE_URL_UNAVAILABLE");
  }

  async function deviceFingerprint(): Promise<string> {
    const existing = (await config.secureStorage.getItem(deviceKey))?.trim();
    if (existing && existing.length >= 8) return existing;
    const created = config.cryptoRandomUUID();
    await config.secureStorage.setItem(deviceKey, created);
    return created;
  }

  function identityClient(): IdentityClient {
    clientValue ??= createIdentityClient(identityBaseUrl());
    return clientValue;
  }

  function identitySession(): IdentitySessionManager {
    sessionValue ??= new IdentitySessionManager(
      identityClient(),
      config.secureStorage,
      deviceFingerprint,
      config.role,
      config.surface,
      config.namespace
    );
    return sessionValue;
  }

  return {
    identityClient,
    identitySession,
    deviceFingerprint,
    restoreIdentitySession: (): Promise<IdentitySessionState> => identitySession().restore(),
    currentIdentityState: (): IdentitySessionState => identitySession().state,
    logoutIdentity: (): Promise<void> => identitySession().logout(),
  };
}
