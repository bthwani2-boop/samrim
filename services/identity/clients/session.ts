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
  | "refresh_conflict";

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
type PendingRefresh = Readonly<{ previous: StoredTokens; requestId: string }>;
type StoredSession = Readonly<StoredTokens & { pendingRefresh?: PendingRefresh }>;
export type IdentitySessionListener = (state: IdentitySessionState) => void;

export type IdentityStorageError = Readonly<{
  kind: "storage";
  operation: "read" | "write";
  cause: unknown;
}>;

const accessTokenSafetySkewMs = 60_000;
const refreshRequestIdPattern = /^[A-Za-z0-9_-]{24,256}$/;

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
  return isIdentityClientError(value) && value.kind === "http" && value.status === 401 && value.code === "REFRESH_STALE";
}

function parseTokenRecord(value: unknown): StoredTokens | null {
  if (!value || typeof value !== "object") return null;
  try {
    const parsed = value as Partial<StoredTokens>;
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

function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown; pendingRefresh?: unknown };
    const tokens = parseTokenRecord(parsed);
    if (!tokens) return null;
    if (parsed.pendingRefresh === undefined) return tokens;
    if (!parsed.pendingRefresh || typeof parsed.pendingRefresh !== "object") return null;
    const pending = parsed.pendingRefresh as { previous?: unknown; requestId?: unknown };
    const previous = parseTokenRecord(pending.previous);
    if (!previous || typeof pending.requestId !== "string" || !refreshRequestIdPattern.test(pending.requestId)) return null;
    return { ...tokens, pendingRefresh: { previous, requestId: pending.requestId } };
  } catch {
    return null;
  }
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

function sameStoredSession(left: StoredSession, right: StoredSession): boolean {
  if (!sameTokens(left, right)) return false;
  if (!left.pendingRefresh || !right.pendingRefresh) return left.pendingRefresh === right.pendingRefresh;
  return left.pendingRefresh.requestId === right.pendingRefresh.requestId && sameTokens(left.pendingRefresh.previous, right.pendingRefresh.previous);
}

function defaultRefreshRequestId(): string {
  const requestId = globalThis.crypto?.randomUUID?.();
  if (!requestId) throw new Error("IDENTITY_REFRESH_REQUEST_ID_UNAVAILABLE");
  return requestId;
}

export class IdentitySessionManager {
  private readonly client: IdentityClient;
  private readonly storage: IdentitySessionStorage;
  private readonly clientInstanceId: () => Promise<string>;
  private readonly role: ActorType;
  private readonly surface: IdentitySurface;
  private readonly key: string;
  private readonly createRefreshRequestId: () => string;
  private readonly developmentSession: (() => Promise<TokenPair>) | undefined;
  private stateValue: IdentitySessionState = { kind: "signed_out", reason: "no_local_session" };
  private tokens: StoredTokens | null = null;
  private refreshInFlight: Promise<IdentitySessionState> | null = null;
  private restoreInFlight: Promise<IdentitySessionState> | null = null;
  private readonly listeners = new Set<IdentitySessionListener>();

  constructor(
    client: IdentityClient,
    storage: IdentitySessionStorage,
    clientInstanceId: () => Promise<string>,
    role: ActorType,
    surface: IdentitySurface,
    storageNamespace: string,
    createRefreshRequestId: () => string = defaultRefreshRequestId,
    developmentSession?: () => Promise<TokenPair>,
  ) {
    this.client = client;
    this.storage = storage;
    this.clientInstanceId = clientInstanceId;
    this.role = role;
    this.surface = surface;
    this.createRefreshRequestId = createRefreshRequestId;
    this.developmentSession = developmentSession;
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
    let currentState = this.stateValue;
    let currentToken = this.tokens?.accessToken;
    if (currentState.kind === "restoring" || (currentState.kind === "authenticated" && !currentToken)) {
      currentState = this.restoreInFlight ? await this.restoreInFlight : await this.restore();
      currentToken = this.tokens?.accessToken;
    }
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
    if (this.stateValue.kind === "signed_out" && (this.stateValue.reason === "explicit_logout" || this.stateValue.reason === "recovery")) {
      return this.stateValue;
    }
    if (this.restoreInFlight) return this.restoreInFlight;

    const restoreOperation = Promise.resolve().then(() => this.restoreFromStorage());
    this.restoreInFlight = restoreOperation;
    try {
      return await restoreOperation;
    } finally {
      if (this.restoreInFlight === restoreOperation) this.restoreInFlight = null;
    }
  }

  private async restoreFromStorage(): Promise<IdentitySessionState> {
    this.transition({ kind: "restoring" });

    let raw: string | null;
    try {
      raw = await this.readStorage();
    } catch (error) {
      return this.degraded(degradedReason(error));
    }

    const stored = parseStoredSession(raw);
    if (!stored) {
      if (raw !== null) {
        try {
          await this.removeStorage();
        } catch {
          return this.degraded("storage_write");
        }
      }
      this.tokens = null;
      return this.restoreDevelopmentSession(raw === null ? "no_local_session" : "corrupt_local_session");
    }

    this.tokens = stored;
    if (stored.pendingRefresh) return this.restorePendingRefresh(stored);
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
    if (!identityAuthorizesSurface(pair.identity, this.role, this.surface)) {
      return this.signOut("surface_mismatch");
    }

    const tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    try {
      await this.persistTokens(tokens);
    } catch (error) {
      return this.degraded(degradedReason(error));
    }
    this.tokens = tokens;
    this.transition({ kind: "authenticated", identity: pair.identity });
    return this.stateValue;
  }

  async refresh(): Promise<IdentitySessionState> {
    if (this.stateValue.kind === "signed_out" && (this.stateValue.reason === "explicit_logout" || this.stateValue.reason === "recovery")) {
      return this.stateValue;
    }
    let storedSession: StoredSession | null;
    try {
      storedSession = parseStoredSession(await this.readStorage());
    } catch (error) {
      return this.degraded(degradedReason(error));
    }
    if (!storedSession) return this.restoreDevelopmentSession("no_local_session");
    this.tokens = storedSession;
    if (storedSession.pendingRefresh) return this.restorePendingRefresh(storedSession);
    return this.refreshStored(storedSession);
  }

  async logout(): Promise<void> {
    let stored: StoredTokens | null = null;
    let storedSession: StoredSession | null = null;
    let localReadError: unknown = null;
    try {
      storedSession = parseStoredSession(await this.readStorage());
      stored = storedSession;
    } catch (error) {
      localReadError = error;
    }
    if (!stored) stored = this.tokens;

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
              const refreshSource = storedSession?.pendingRefresh?.previous ?? stored;
              if (!refreshSource) throw new Error("IDENTITY_REFRESH_TOKEN_UNAVAILABLE");
              const refreshRequestId = storedSession?.pendingRefresh?.requestId ?? this.createRefreshRequestId();
              const pair = await this.client.refresh({
                refreshToken: refreshSource.refreshToken,
                clientInstanceId,
                refreshRequestId,
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
      this.tokens = null;
      await this.removeStorageBestEffort();
      this.transition({ kind: "signed_out", reason: "explicit_logout" });
    }
    if (remoteError) throw remoteError;
  }

  async clearLocalSession(): Promise<IdentitySessionState> {
    this.tokens = null;
    await this.removeStorageBestEffort();
    return this.signOut("recovery");
  }

  private async refreshStored(stored: StoredTokens, requestId?: string, prepared = false): Promise<IdentitySessionState> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh(stored, requestId, prepared);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async performRefresh(stored: StoredTokens, requestId: string | undefined, prepared: boolean): Promise<IdentitySessionState> {
    try {
      const clientInstanceId = (await this.clientInstanceId()).trim();
      if (clientInstanceId.length < 8) throw new Error("IDENTITY_CLIENT_INSTANCE_ID_UNAVAILABLE");
      const effectiveRequestId = requestId ?? this.createRefreshRequestId();
      if (!refreshRequestIdPattern.test(effectiveRequestId)) throw new Error("IDENTITY_REFRESH_REQUEST_ID_UNAVAILABLE");
      if (!prepared) {
        await this.persistSession({ ...stored, pendingRefresh: { previous: stored, requestId: effectiveRequestId } });
      }
      const pair = await this.client.refresh({ refreshToken: stored.refreshToken, clientInstanceId, refreshRequestId: effectiveRequestId });
      return this.adoptRefreshed(pair, stored, effectiveRequestId);
    } catch (error) {
      if (isRefreshStaleError(error)) {
        return this.reconcileRefreshConflict(stored);
      }
      if (isIdentityUnauthenticated(error)) return this.restoreDevelopmentSession("terminal_invalidated");
      return this.degraded(degradedReason(error));
    }
  }

  private async restorePendingRefresh(stored: StoredSession): Promise<IdentitySessionState> {
    const pending = stored.pendingRefresh;
    if (!pending) return this.degraded("unknown");
    try {
      const identity = await this.client.session(stored.accessToken);
      if (!identityAuthorizesSurface(identity, this.role, this.surface)) {
        return this.signOut("surface_mismatch");
      }
      try {
        await this.persistTokens(stored);
      } catch (error) {
        return this.degraded(degradedReason(error));
      }
      this.tokens = stored;
      this.transition({ kind: "authenticated", identity });
      return this.stateValue;
    } catch (error) {
      if (!isIdentityUnauthenticated(error)) return this.degraded(degradedReason(error));
      this.tokens = pending.previous;
      return this.refreshStored(pending.previous, pending.requestId, true);
    }
  }

  private async adoptRefreshed(pair: TokenPair, previous: StoredTokens, requestId: string): Promise<IdentitySessionState> {
    if (!identityAuthorizesSurface(pair.identity, this.role, this.surface)) return this.signOut("surface_mismatch");
    const next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    try {
      await this.persistSession({ ...next, pendingRefresh: { previous, requestId } });
      await this.persistTokens(next);
    } catch (error) {
      this.tokens = previous;
      return this.degraded(degradedReason(error));
    }
    this.tokens = next;
    this.transition({ kind: "authenticated", identity: pair.identity });
    return this.stateValue;
  }

  private async reconcileRefreshConflict(stored: StoredTokens): Promise<IdentitySessionState> {
    try {
      const fresh = parseStoredSession(await this.readStorage());
      if (!fresh || sameTokens(fresh, stored)) return this.degraded("refresh_conflict");
      const identity = await this.client.session(fresh.accessToken);
      if (!identityAuthorizesSurface(identity, this.role, this.surface)) return this.signOut("surface_mismatch");
      if (fresh.pendingRefresh) {
        try {
          await this.persistTokens(fresh);
        } catch (error) {
          return this.degraded(degradedReason(error));
        }
      }
      this.tokens = fresh;
      this.transition({ kind: "authenticated", identity });
      return this.stateValue;
    } catch (error) {
      if (isIdentityUnauthenticated(error)) return this.degraded("refresh_conflict");
      return this.degraded(degradedReason(error));
    }
  }

  private async restoreDevelopmentSession(fallbackReason: IdentitySessionSignOutReason): Promise<IdentitySessionState> {
    if (!this.developmentSession) return this.signOut(fallbackReason);
    this.tokens = null;
    await this.removeStorageBestEffort();
    try {
      return this.adopt(await this.developmentSession());
    } catch (error) {
      if (isIdentityClientError(error) && error.kind === "http" && (error.status === 403 || error.status === 404 || error.status === 409)) {
        return this.signOut(fallbackReason);
      }
      return this.degraded(degradedReason(error));
    }
  }

  private async readStorage(): Promise<string | null> {
    try {
      return await this.storage.getItem(this.key);
    } catch (error) {
      throw identityStorageError("read", error);
    }
  }

  private async persistTokens(tokens: StoredTokens): Promise<void> {
    await this.persistSession({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }

  private async persistSession(session: StoredSession): Promise<void> {
    try {
      await this.storage.setItem(this.key, JSON.stringify(session));
      const readBack = parseStoredSession(await this.storage.getItem(this.key));
      if (!readBack || !sameStoredSession(readBack, session)) throw new Error("IDENTITY_SESSION_STORAGE_READBACK_MISMATCH");
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
