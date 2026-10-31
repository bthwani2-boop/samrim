declare const process: { env: Record<string, string | undefined> };
declare const __DEV__: boolean;

import type { IdentityClient } from "./client";
import { createIdentityClient } from "./client";
import type { ActorType } from "./generated/identity-types";
import { identityStorageError, type IdentitySessionState, type IdentitySurface } from "./session";
import { IdentitySessionManager } from "./session";
import { validateServiceUrl } from "./url";

export type MobileIdentityRuntimeConfig = {
  role: ActorType;
  surface: IdentitySurface;
  namespace: string;
  /**
   * Keeps ordinary local development ceremony-free while allowing an
   * explicit activation-proof run to exercise the real auth surface.
   * Production never exposes the development-session route because the
   * __DEV__ boundary below remains mandatory.
   */
  allowDevelopmentSessionFallback?: boolean;
  /** Partner Expo Web only: server-owned HttpOnly refresh cookie, never browser token storage. */
  partnerBrowserSession?: boolean;
  secureStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  cryptoRandomUUID: () => string;
  explicitApiUrl?: string | undefined;
};

export type ManagedMobileRole = "partner" | "captain";

export type ManagedMobileIdentityRuntimeConfig = Omit<MobileIdentityRuntimeConfig, "role"> & {
  role: ManagedMobileRole;
};

export function createMobileIdentityRuntime(config: MobileIdentityRuntimeConfig) {
  const deviceKey = `${config.namespace}.identity.device.v1`;
  let clientValue: IdentityClient | null = null;
  let sessionValue: IdentitySessionManager | null = null;

  function identityBaseUrl(): string {
    const explicit = config.explicitApiUrl?.trim();
    if (!explicit) throw new Error("IDENTITY_BASE_URL_REQUIRED");
    // Local UI and Identity may be configured with different loopback aliases.
    // SameSite=Strict cookies require the browser to use the same host label.
    if (config.partnerBrowserSession && typeof window !== "undefined") {
      const api = new URL(explicit);
      const loopback = (host: string) => host === "localhost" || host === "127.0.0.1";
      if (loopback(api.hostname) && loopback(window.location.hostname) && api.protocol === window.location.protocol) {
        api.hostname = window.location.hostname;
        return validateServiceUrl(api.toString(), "IDENTITY_BASE_URL");
      }
    }
    return validateServiceUrl(explicit, "IDENTITY_BASE_URL");
  }

  async function clientInstanceId(): Promise<string> {
    let existingValue: string | null;
    try {
      existingValue = await config.secureStorage.getItem(deviceKey);
    } catch (error) {
      throw identityStorageError("read", error);
    }
    const existing = existingValue?.trim();
    if (existing && existing.length >= 8) return existing;
    const created = config.cryptoRandomUUID();
    try {
      await config.secureStorage.setItem(deviceKey, created);
    } catch (error) {
      throw identityStorageError("write", error);
    }
    return created;
  }

  function identityClient(): IdentityClient {
    clientValue ??= createIdentityClient(identityBaseUrl(), 8_000, config.partnerBrowserSession === true);
    return clientValue;
  }

  function identitySession(): IdentitySessionManager {
    sessionValue ??= new IdentitySessionManager(
      identityClient(),
      config.secureStorage,
      clientInstanceId,
      config.role,
      config.surface,
      config.namespace,
      config.cryptoRandomUUID,
      __DEV__ && config.allowDevelopmentSessionFallback !== false
        ? async () => identityClient().developmentSession(config.role, await clientInstanceId())
        : undefined,
      config.partnerBrowserSession ? () => identityClient().restorePartnerBrowserSession() : undefined,
    );
    return sessionValue;
  }

  return {
    identityClient,
    identitySession,
    clientInstanceId,
    getUsableAccessToken: (): Promise<string> => identitySession().getUsableAccessToken(),
    subscribeIdentityState: (listener: (state: IdentitySessionState) => void): (() => void) => identitySession().subscribe(listener),
    restoreIdentitySession: (): Promise<IdentitySessionState> => identitySession().restore(),
    currentIdentityState: (): IdentitySessionState => identitySession().state,
    logoutIdentity: (): Promise<void> => identitySession().logout(),
  };
}

export function createManagedMobileIdentityBinding(config: ManagedMobileIdentityRuntimeConfig) {
  const runtime = createMobileIdentityRuntime(config);

  return {
    ...runtime,
    requestManagedActivation: (phone: string) => runtime.identityClient().requestManagedActivation({ phone, role: config.role }),
    requestManagedRecovery: (phone: string) => runtime.identityClient().requestManagedRecovery({ phone, role: config.role }),
    recoverManagedIdentity: async (phone: string, verificationCode: string, password: string) => {
      const result = await runtime.identityClient().recoverManaged({ phone, role: config.role, verificationCode, password });
      await runtime.identitySession().clearLocalSession();
      return result;
    },
    activateManagedIdentity: async (phone: string, verificationCode: string, password: string): Promise<IdentitySessionState> => {
      const pair = await runtime.identityClient().activateManaged({
        phone,
        role: config.role,
        verificationCode,
        password,
        clientInstanceId: await runtime.clientInstanceId(),
      });
      return runtime.identitySession().adopt(pair);
    },
    loginManagedIdentity: async (phone: string, password: string): Promise<IdentitySessionState> => {
      const pair = await runtime.identityClient().loginManaged({
        phone,
        role: config.role,
        password,
        clientInstanceId: await runtime.clientInstanceId(),
      });
      return runtime.identitySession().adopt(pair);
    },
  };
}
