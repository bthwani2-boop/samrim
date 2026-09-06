import type { ActorIdentity, ActorType, TokenPair } from "./generated/identity-types";
import { type IdentityClient, type IdentityClientError, isIdentityClientError } from "./client";

export interface IdentitySessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type IdentitySurface =
  | "app-client"
  | "app-partner"
  | "app-captain"
  | "app-field"
  | "control-panel";

export type IdentitySessionState =
  | Readonly<{ kind: "signed_out" }>
  | Readonly<{ kind: "restoring" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "service_unavailable"; reason: string }>
  | Readonly<{ kind: "refresh_conflict" }>;

type StoredTokens = Readonly<{ accessToken: string; refreshToken: string }>;

const roleSurface: Readonly<Record<ActorType, IdentitySurface>> = Object.freeze({
  client: "app-client",
  partner: "app-partner",
  captain: "app-captain",
  field: "app-field",
  operator: "control-panel",
  platform_owner: "control-panel",
});

export function identityRoleSurface(role: ActorType): IdentitySurface {
  return roleSurface[role];
}

export function identityAuthorizesSurface(
  identity: ActorIdentity,
  role: ActorType,
  surface: IdentitySurface,
): boolean {
  return identity.role === role && identity.surface === surface && roleSurface[role] === surface;
}

function isIdentityServiceUnavailable(value: unknown): value is IdentityClientError {
  return (
    isIdentityClientError(value) &&
    (value.kind === "network" || (value.kind === "http" && value.status >= 500))
  );
}

function isIdentityUnauthenticated(value: unknown): value is IdentityClientError {
  return isIdentityClientError(value) && value.kind === "http" && value.status === 401;
}

function isRefreshStaleError(value: unknown): boolean {
  if (isIdentityClientError(value)) {
    if (value.kind === "http" && (value.code === "REFRESH_STALE" || value.message.includes("REFRESH_STALE"))) return true;
  }
  if (value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === "REFRESH_STALE") {
    return true;
  }
  return false;
}

function parseStoredTokens(raw: string | null): StoredTokens | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (
      typeof parsed.accessToken === "string" &&
      parsed.accessToken.length >= 20 &&
      typeof parsed.refreshToken === "string" &&
      parsed.refreshToken.length >= 20
    ) {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    }
  } catch {
    // Corrupt local state is discarded below.
  }
  return null;
}

export class IdentitySessionManager {
  private readonly client: IdentityClient;
  private readonly storage: IdentitySessionStorage;
  private readonly deviceFingerprint: () => Promise<string>;
  private readonly role: ActorType;
  private readonly surface: IdentitySurface;
  private readonly key: string;
  private stateValue: IdentitySessionState = { kind: "signed_out" };
  private tokens: StoredTokens | null = null;
  private refreshInFlight: Promise<IdentitySessionState> | null = null;

  constructor(
    client: IdentityClient,
    storage: IdentitySessionStorage,
    deviceFingerprint: () => Promise<string>,
    role: ActorType,
    surface: IdentitySurface,
    storageNamespace: string,
  ) {
    this.client = client;
    this.storage = storage;
    this.deviceFingerprint = deviceFingerprint;
    this.role = role;
    this.surface = surface;
    if (identityRoleSurface(role) !== surface) throw new Error("IDENTITY_ROLE_SURFACE_MISMATCH");
    this.key = storageNamespace + ".identity.session.v1";
  }

  get state(): IdentitySessionState {
    return this.stateValue;
  }

  async restore(): Promise<IdentitySessionState> {
    this.stateValue = { kind: "restoring" };
    const stored = parseStoredTokens(await this.storage.getItem(this.key));
    if (!stored) {
      await this.storage.removeItem(this.key);
      this.tokens = null;
      return (this.stateValue = { kind: "signed_out" });
    }

    try {
      const identity = await this.client.session(stored.accessToken);
      if (!identityAuthorizesSurface(identity, this.role, this.surface)) {
        await this.clearLocal();
        return (this.stateValue = { kind: "signed_out" });
      }
      this.tokens = stored;
      return (this.stateValue = { kind: "authenticated", identity });
    } catch (error) {
      if (isIdentityServiceUnavailable(error)) {
        return (this.stateValue = { kind: "service_unavailable", reason: error.message });
      }
      return this.refreshStored(stored);
    }
  }

  async adopt(pair: TokenPair): Promise<IdentitySessionState> {
    if (!identityAuthorizesSurface(pair.identity, this.role, this.surface)) {
      throw new Error("IDENTITY_SESSION_SURFACE_MISMATCH");
    }
    const tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    await this.storage.setItem(this.key, JSON.stringify(tokens));
    this.tokens = tokens;
    return (this.stateValue = { kind: "authenticated", identity: pair.identity });
  }

  async refresh(): Promise<IdentitySessionState> {
    const stored = this.tokens ?? parseStoredTokens(await this.storage.getItem(this.key));
    if (!stored) return (this.stateValue = { kind: "signed_out" });
    return this.refreshStored(stored);
  }

  async logout(): Promise<void> {
    const stored = this.tokens ?? parseStoredTokens(await this.storage.getItem(this.key));
    let remoteError: unknown = null;
    try {
      if (stored) {
        try {
          await this.client.logout(stored.accessToken);
        } catch (error) {
          if (isIdentityUnauthenticated(error)) {
            try {
              const fingerprint = (await this.deviceFingerprint()).trim();
              if (fingerprint.length < 8) throw new Error("IDENTITY_DEVICE_FINGERPRINT_UNAVAILABLE");
              const pair = await this.client.refresh({
                refreshToken: stored.refreshToken,
                deviceFingerprint: fingerprint,
              });
              if (!identityAuthorizesSurface(pair.identity, this.role, this.surface)) {
                throw new Error("IDENTITY_SESSION_SURFACE_MISMATCH");
              }
              await this.client.logout(pair.accessToken);
            } catch (refreshError) {
              if (!isIdentityUnauthenticated(refreshError)) remoteError = refreshError;
            }
          } else {
            remoteError = error;
          }
        }
      }
    } finally {
      await this.clearLocal();
      this.stateValue = { kind: "signed_out" };
    }
    if (remoteError) throw remoteError;
  }

  private async refreshStored(stored: StoredTokens): Promise<IdentitySessionState> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh(stored);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async performRefresh(stored: StoredTokens): Promise<IdentitySessionState> {
    try {
      const fingerprint = (await this.deviceFingerprint()).trim();
      if (fingerprint.length < 8) throw new Error("IDENTITY_DEVICE_FINGERPRINT_UNAVAILABLE");
      return this.adopt(await this.client.refresh({ refreshToken: stored.refreshToken, deviceFingerprint: fingerprint }));
    } catch (error) {
      if (isIdentityServiceUnavailable(error)) {
        return (this.stateValue = { kind: "service_unavailable", reason: error.message });
      }
      if (isRefreshStaleError(error)) {
        const reRead = parseStoredTokens(await this.storage.getItem(this.key));
        if (reRead && reRead.refreshToken !== stored.refreshToken) {
          try {
            const identity = await this.client.session(reRead.accessToken);
            if (identityAuthorizesSurface(identity, this.role, this.surface)) {
              this.tokens = reRead;
              return (this.stateValue = { kind: "authenticated", identity });
            }
          } catch (sessionError) {
            if (isIdentityServiceUnavailable(sessionError)) {
              return (this.stateValue = { kind: "service_unavailable", reason: sessionError.message });
            }
          }
        }
        return (this.stateValue = { kind: "refresh_conflict" });
      }
      await this.clearLocal();
      return (this.stateValue = { kind: "signed_out" });
    }
  }

  private async clearLocal(): Promise<void> {
    this.tokens = null;
    await this.storage.removeItem(this.key);
  }
}
