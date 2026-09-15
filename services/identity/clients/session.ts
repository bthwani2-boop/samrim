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

export type IdentitySessionDegradedReason =
  | "network"
  | "service_unavailable"
  | "rate_limited"
  | "unexpected_http"
  | "unknown"
  | "storage_read"
  | "storage_write"
  | "client_instance"
  | "refresh_conflict"
  | "reconciliation_required";

export type IdentitySessionSignOutReason =
  | "no_local_session"
  | "corrupt_local_session"
  | "terminal_invalidated"
  | "surface_mismatch"
  | "local_proof_invalid"
  | "explicit_logout"
  | "recovery";

export type IdentitySessionState =
  | Readonly<{ kind: "signed_out"; reason: IdentitySessionSignOutReason }>
  | Readonly<{ kind: "restoring" }>
  | Readonly<{ kind: "authenticated"; identity: ActorIdentity }>
  | Readonly<{ kind: "degraded"; reason: IdentitySessionDegradedReason }>;

type StoredTokens = Readonly<{ accessToken: string; refreshToken: string }>;
export type IdentitySessionListener = (state: IdentitySessionState) => void;

export type IdentityStorageError = Readonly<{
  kind: "storage";
  operation: "read" | "write";
  cause: unknown;
}>;

const accessTokenSafetySkewMs = 60_000;

const roleSurface: Readonly<Record<ActorType, IdentitySurface>> = Object.freeze({
  client: "app-client",
  partner: "app-partner",
  captain: "app-captain",
  field: "app-field",
  operator: "control-panel",
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

export function isIdentityStorageError(value: unknown): value is IdentityStorageError {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "storage" &&
      ((value as { operation?: unknown }).operation === "read" || (value as { operation?: unknown }).operation === "write"),
  );
}

export function identityStorageError(operation: IdentityStorageError["operation"], cause: unknown): IdentityStorageError {
  return { kind: "storage", operation, cause };
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

function degradedReason(value: unknown): IdentitySessionDegradedReason {
  if (isIdentityStorageError(value)) return value.operation === "read" ? "storage_read" : "storage_write";
  if (isIdentityClientError(value)) {
    if (value.kind === "network") return "network";
    if (value.status === 429) return "rate_limited";
    if (value.status >= 500) return "service_unavailable";
    return "unexpected_http";
  }
  if (value instanceof Error && value.message === "IDENTITY_CLIENT_INSTANCE_ID_UNAVAILABLE") return "client_instance";
  return "unknown";
}

function sameTokens(left: StoredTokens, right: StoredTokens): boolean {
  return left.accessToken === right.accessToken && left.refreshToken === right.refreshToken;
}

export class IdentitySessionManager {
  private readonly client: IdentityClient;
  private readonly storage: IdentitySessionStorage;
  private readonly clientInstanceId: () => Promise<string>;
  private readonly role: ActorType;
  private readonly surface: IdentitySurface;
  private readonly key: string;
  private stateValue: IdentitySessionState = { kind: "signed_out", reason: "no_local_session" };
  private tokens: StoredTokens | null = null;
  private pendingPair: TokenPair | null = null;
  private refreshInFlight: Promise<IdentitySessionState> | null = null;
  private readonly listeners = new Set<IdentitySessionListener>();

  constructor(
    client: IdentityClient,
    storage: IdentitySessionStorage,
    clientInstanceId: () => Promise<string>,
    role: ActorType,
    surface: IdentitySurface,
    storageNamespace: string,
  ) {
    this.client = client;
    this.storage = storage;
    this.clientInstanceId = clientInstanceId;
    this.role = role;
    this.surface = surface;
    if (identityRoleSurface(role) !== surface) throw new Error("IDENTITY_ROLE_SURFACE_MISMATCH");
    this.key = storageNamespace + ".identity.session.v1";
  }

  get state(): IdentitySessionState {
    return this.stateValue;
  }

  subscribe(listener: IdentitySessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getUsableAccessToken(): Promise<string> {
    const currentState = this.stateValue;
    const currentToken = this.tokens?.accessToken;
    if (currentState.kind !== "authenticated" || !currentToken) {
      throw new Error("IDENTITY_ACCESS_TOKEN_UNAVAILABLE");
    }

    const expiresAt = Date.parse(currentState.identity.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + accessTokenSafetySkewMs) {
      return currentToken;
    }

    const refreshed = await this.refresh();
    if (refreshed.kind !== "authenticated") {
      throw new Error(`IDENTITY_ACCESS_TOKEN_${refreshed.kind.toUpperCase()}`);
    }
    const refreshedToken = this.tokens?.accessToken;
    const refreshedExpiry = Date.parse(refreshed.identity.expiresAt);
    if (!refreshedToken || !Number.isFinite(refreshedExpiry) || refreshedExpiry <= Date.now() + accessTokenSafetySkewMs) {
      await this.signOut("local_proof_invalid");
      throw new Error("IDENTITY_ACCESS_TOKEN_UNUSABLE");
    }
    return refreshedToken;
  }

  async restore(): Promise<IdentitySessionState> {
    this.transition({ kind: "restoring" });

    const pendingState = await this.restorePendingPair();
    if (pendingState) return pendingState;

    let raw: string | null;
    try {
      raw = await this.readStorage();
    } catch (error) {
      return this.degraded(degradedReason(error));
    }

    const stored = parseStoredTokens(raw);
    if (!stored) {
      if (raw !== null) {
        try {
          await this.removeStorage();
        } catch {
          return this.degraded("storage_write");
        }
      }
      this.tokens = null;
      return this.signOut(raw === null ? "no_local_session" : "corrupt_local_session");
    }

    this.tokens = stored;
    try {
      const identity = await this.client.session(stored.accessToken);
      if (!identityAuthorizesSurface(identity, this.role, this.surface)) {
        return this.signOut("surface_mismatch");
      }
      this.transition({ kind: "authenticated", identity });
      return this.stateValue;
    } catch (error) {
      if (isIdentityUnauthenticated(error)) return this.refreshStored(stored);
      return this.degraded(degradedReason(error));
    }
  }

  async adopt(pair: TokenPair): Promise<IdentitySessionState> {
    this.pendingPair = null;
    const previousTokens = this.tokens;
    if (!identityAuthorizesSurface(pair.identity, this.role, this.surface)) {
      return this.reconcilePair(pair, previousTokens, "surface_mismatch");
    }

    const tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    try {
      await this.persistTokens(tokens);
    } catch {
      return this.reconcilePair(pair, previousTokens);
    }
    this.tokens = tokens;
    this.transition({ kind: "authenticated", identity: pair.identity });
    return this.stateValue;
  }

  async refresh(): Promise<IdentitySessionState> {
    let stored = this.tokens;
    if (!stored) {
      try {
        stored = parseStoredTokens(await this.readStorage());
      } catch (error) {
        return this.degraded(degradedReason(error));
      }
    }
    if (!stored) return this.signOut("no_local_session");
    this.tokens = stored;
    return this.refreshStored(stored);
  }

  async logout(): Promise<void> {
    let stored: StoredTokens | null = this.tokens;
    let localReadError: unknown = null;
    if (!stored) {
      try {
        stored = parseStoredTokens(await this.readStorage());
      } catch (error) {
        localReadError = error;
      }
    }

    let remoteError: unknown = localReadError;
    try {
      if (stored) {
        try {
          await this.client.logout(stored.accessToken);
        } catch (error) {
          if (isIdentityUnauthenticated(error)) {
            try {
              const clientInstanceId = (await this.clientInstanceId()).trim();
              if (clientInstanceId.length < 8) throw new Error("IDENTITY_CLIENT_INSTANCE_ID_UNAVAILABLE");
              const pair = await this.client.refresh({
                refreshToken: stored.refreshToken,
                clientInstanceId,
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
      this.pendingPair = null;
      this.tokens = null;
      await this.removeStorageBestEffort();
      this.transition({ kind: "signed_out", reason: "explicit_logout" });
    }
    if (remoteError) throw remoteError;
  }

  async clearLocalSession(): Promise<IdentitySessionState> {
    this.pendingPair = null;
    this.tokens = null;
    await this.removeStorageBestEffort();
    return this.signOut("recovery");
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
      const clientInstanceId = (await this.clientInstanceId()).trim();
      if (clientInstanceId.length < 8) throw new Error("IDENTITY_CLIENT_INSTANCE_ID_UNAVAILABLE");
      const pair = await this.client.refresh({ refreshToken: stored.refreshToken, clientInstanceId });
      return this.adopt(pair);
    } catch (error) {
      if (isRefreshStaleError(error)) {
        let reRead: StoredTokens | null;
        try {
          reRead = parseStoredTokens(await this.readStorage());
        } catch (storageError) {
          return this.degraded(degradedReason(storageError));
        }
        if (reRead && reRead.refreshToken !== stored.refreshToken) {
          try {
            const identity = await this.client.session(reRead.accessToken);
            if (identityAuthorizesSurface(identity, this.role, this.surface)) {
              this.tokens = reRead;
              this.transition({ kind: "authenticated", identity });
              return this.stateValue;
            }
            return this.signOut("surface_mismatch");
          } catch (sessionError) {
            if (isIdentityUnauthenticated(sessionError)) return this.degraded("refresh_conflict");
            return this.degraded(degradedReason(sessionError));
          }
        }
        return this.degraded("refresh_conflict");
      }
      if (isIdentityUnauthenticated(error)) return this.signOut("terminal_invalidated");
      return this.degraded(degradedReason(error));
    }
  }

  private async restorePendingPair(): Promise<IdentitySessionState | null> {
    const pending = this.pendingPair;
    if (!pending) return null;

    try {
      const identity = await this.client.session(pending.accessToken);
      if (!identityAuthorizesSurface(identity, this.role, this.surface)) {
        this.pendingPair = null;
        return this.signOut("surface_mismatch");
      }
      await this.persistTokens({ accessToken: pending.accessToken, refreshToken: pending.refreshToken });
      this.pendingPair = null;
      this.tokens = { accessToken: pending.accessToken, refreshToken: pending.refreshToken };
      this.transition({ kind: "authenticated", identity });
      return this.stateValue;
    } catch (error) {
      if (isIdentityUnauthenticated(error)) {
        this.pendingPair = null;
        return this.signOut("terminal_invalidated");
      }
      return this.degraded(degradedReason(error));
    }
  }

  private async reconcilePair(
    pair: TokenPair,
    previousTokens: StoredTokens | null,
    signOutReason: IdentitySessionSignOutReason = "terminal_invalidated",
  ): Promise<IdentitySessionState> {
    this.pendingPair = pair;
    let remoteRevoked = false;
    try {
      await this.client.logout(pair.accessToken);
      remoteRevoked = true;
    } catch (error) {
      remoteRevoked = isIdentityUnauthenticated(error);
    }
    if (remoteRevoked) {
      this.pendingPair = null;
      this.tokens = null;
      await this.removeStorageBestEffort();
      return this.signOut(signOutReason === "surface_mismatch" ? signOutReason : "terminal_invalidated");
    }
    this.tokens = previousTokens;
    return this.degraded("reconciliation_required");
  }

  private async readStorage(): Promise<string | null> {
    try {
      return await this.storage.getItem(this.key);
    } catch (error) {
      throw identityStorageError("read", error);
    }
  }

  private async persistTokens(tokens: StoredTokens): Promise<void> {
    try {
      await this.storage.setItem(this.key, JSON.stringify(tokens));
      const readBack = parseStoredTokens(await this.storage.getItem(this.key));
      if (!readBack || !sameTokens(readBack, tokens)) throw new Error("IDENTITY_SESSION_STORAGE_READBACK_MISMATCH");
    } catch (error) {
      if (isIdentityStorageError(error)) throw error;
      throw identityStorageError("write", error);
    }
  }

  private async removeStorage(): Promise<void> {
    try {
      await this.storage.removeItem(this.key);
    } catch (error) {
      throw identityStorageError("write", error);
    }
  }

  private async removeStorageBestEffort(): Promise<void> {
    try {
      await this.removeStorage();
    } catch {
      // Local termination remains fail-closed even if cleanup cannot be confirmed.
    }
  }

  private async signOut(reason: IdentitySessionSignOutReason): Promise<IdentitySessionState> {
    this.tokens = null;
    await this.removeStorageBestEffort();
    this.transition({ kind: "signed_out", reason });
    return this.stateValue;
  }

  private degraded(reason: IdentitySessionDegradedReason): IdentitySessionState {
    this.transition({ kind: "degraded", reason });
    return this.stateValue;
  }

  private transition(next: IdentitySessionState): void {
    this.stateValue = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // A presentation listener cannot interrupt the canonical session transition.
      }
    }
  }
}
