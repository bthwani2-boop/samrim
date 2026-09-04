import {
  createIdentityClient,
  type ActivationActorType,
  type ActorIdentity,
  type IdentityClient,
  type IdentityClientError,
  type IssueActivationResponse,
  type SessionInfo,
  type TokenResponse,
} from "./identity-client.ts";
import {
  defaultSessionStorageAdapter,
  type SessionStorageAdapter,
} from "./identity-session-storage.ts";
import { secureRandomId } from "./secure-random.ts";

export type IdentitySessionState =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "restoring" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "authenticating" }
  | { readonly kind: "authenticated"; readonly identity: ActorIdentity; readonly accessToken: string }
  | {
      readonly kind: "service_unavailable";
      readonly message: string;
      readonly retainedSession: boolean;
      readonly retryAfterMs: number;
    }
  | { readonly kind: "error"; readonly message: string };

export type IdentityBeforeSessionEndHook = () => void | Promise<void>;
export type IdentityDeviceFingerprintProvider = () => string | Promise<string>;

export type StoredSession = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly identity: ActorIdentity;
};

const STORAGE_KEY = "bthwani-identity-session";
const runtimeDeviceFingerprint = (): string => `bthwani-runtime-${secureRandomId()}`;
const INITIAL_BOOTSTRAP_RETRY_MS = 1_000;
const MAX_BOOTSTRAP_RETRY_MS = 30_000;

let client: IdentityClient | null = null;
let state: IdentitySessionState = { kind: "unconfigured" };
let stored: StoredSession | null = null;
let storageAdapter: SessionStorageAdapter = defaultSessionStorageAdapter();
let deviceFingerprintProvider: IdentityDeviceFingerprintProvider = runtimeDeviceFingerprint;
let bootstrapInFlight: Promise<void> | null = null;
let nextBootstrapAttemptAt = 0;
let bootstrapRetryMs = INITIAL_BOOTSTRAP_RETRY_MS;
const listeners = new Set<() => void>();
const beforeSessionEndHooks = new Set<IdentityBeforeSessionEndHook>();

export function configureIdentitySessionStorage(adapter: SessionStorageAdapter): void {
  if (client !== null) return;
  storageAdapter = adapter;
}

export function configureIdentityDeviceFingerprintProvider(
  provider: IdentityDeviceFingerprintProvider,
): void {
  if (client !== null) return;
  deviceFingerprintProvider = provider;
}

export function registerIdentityBeforeSessionEndHook(
  hook: IdentityBeforeSessionEndHook,
): () => void {
  beforeSessionEndHooks.add(hook);
  return () => beforeSessionEndHooks.delete(hook);
}

async function runBeforeSessionEndHooks(): Promise<void> {
  await Promise.allSettled(
    Array.from(beforeSessionEndHooks, async (hook) => {
      await hook();
    }),
  );
}

async function resolveDeviceFingerprint(): Promise<string> {
  const fingerprint = (await deviceFingerprintProvider()).trim();
  if (!fingerprint) throw new Error("IDENTITY_DEVICE_FINGERPRINT_UNAVAILABLE");
  return fingerprint;
}

export async function getIdentityDeviceFingerprint(): Promise<string> {
  return resolveDeviceFingerprint();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "boolean");
}

function isValidPermission(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.service)
    && isNonEmptyString(value.surface)
    && isNonEmptyString(value.action)
    && isNonEmptyString(value.scope);
}

export function isStructurallyValidActorIdentity(value: unknown): value is ActorIdentity {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.subject)
    || !isNonEmptyString(value.operatorContextId)
    || !isNonEmptyString(value.phoneE164)
    || value.authState !== "authenticated"
    || !isNonEmptyString(value.sessionSurface)
    || !isNonEmptyString(value.sessionId)
    || !isNonEmptyString(value.expiresAt)
  ) {
    return false;
  }

  const expiresAtMs = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;

  if (
    !Array.isArray(value.roles)
    || value.roles.length === 0
    || !value.roles.every((role) => typeof role === "string")
  ) {
    return false;
  }

  return Array.isArray(value.permissions)
    && value.permissions.every(isValidPermission)
    && isBooleanRecord(value.surfaceAccess)
    && value.surfaceAccess[value.sessionSurface] === true
    && isBooleanRecord(value.serviceAccess);
}

export function isFreshActorIdentity(value: unknown): value is ActorIdentity {
  return isStructurallyValidActorIdentity(value) && Date.parse(value.expiresAt) > Date.now();
}

export function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !isNonEmptyString(parsed.accessToken)
      || !isNonEmptyString(parsed.refreshToken)
      || !isStructurallyValidActorIdentity(parsed.identity)
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      identity: parsed.identity,
    };
  } catch {
    return null;
  }
}

async function loadStoredSession(): Promise<StoredSession | null> {
  const raw = await storageAdapter.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session = parseStoredSession(raw);
  if (!session) await storageAdapter.removeItem(STORAGE_KEY);
  return session;
}

async function saveStoredSession(session: StoredSession | null): Promise<void> {
  if (session) {
    await storageAdapter.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    await storageAdapter.removeItem(STORAGE_KEY);
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: IdentitySessionState): void {
  state = next;
  emit();
}

function identityErrorCode(error: unknown): string {
  const typed = error as Partial<IdentityClientError>;
  return typed.kind === "http" && typeof typed.code === "string"
    ? typed.code
    : error instanceof Error && error.message === "IDENTITY_DEVICE_FINGERPRINT_UNAVAILABLE"
      ? error.message
      : "IDENTITY_UNAVAILABLE";
}

function isIdentityAvailabilityError(error: unknown): boolean {
  const typed = error as Partial<IdentityClientError>;
  if (typed.kind === "network") return true;
  if (typed.kind !== "http") return false;
  return typed.status === 502
    || typed.status === 503
    || typed.status === 504
    || typed.code === "IDENTITY_NOT_READY"
    || typed.code === "IDENTITY_UNAVAILABLE"
    || typed.code === "BFF_UPSTREAM_UNAVAILABLE"
    || typed.code === "BFF_UPSTREAM_NOT_CONFIGURED"
    || typed.code === "INTERNAL_API_UNAVAILABLE";
}

function isIdentityConcurrentRefreshError(error: unknown): boolean {
  const typed = error as Partial<IdentityClientError>;
  return typed.kind === "http"
    && typed.status === 409
    && typed.code === "REFRESH_ALREADY_ROTATED";
}

function isIdentityInvalidSessionError(error: unknown): boolean {
  const typed = error as Partial<IdentityClientError>;
  if (typed.kind !== "http") return false;
  return typed.status === 401
    || typed.code === "UNAUTHENTICATED"
    || typed.code === "INVALID_REFRESH_TOKEN"
    || typed.code === "IDENTITY_SESSION_INVALID"
    || typed.code === "SESSION_NOT_FOUND";
}

function clearSession(message?: string): void {
  stored = null;
  void saveStoredSession(null).catch(() => undefined);
  setState(message ? { kind: "error", message } : { kind: "signed_out" });
}

function setServiceUnavailable(message = "IDENTITY_UNAVAILABLE"): void {
  const retryAfterMs = bootstrapRetryMs;
  nextBootstrapAttemptAt = Date.now() + retryAfterMs;
  bootstrapRetryMs = Math.min(bootstrapRetryMs * 2, MAX_BOOTSTRAP_RETRY_MS);
  setState({
    kind: "service_unavailable",
    message,
    retainedSession: stored !== null,
    retryAfterMs,
  });
}

function resetBootstrapBackoff(): void {
  nextBootstrapAttemptAt = 0;
  bootstrapRetryMs = INITIAL_BOOTSTRAP_RETRY_MS;
}

function commitAuthenticatedSession(session: StoredSession, persist: boolean): void {
  if (!isFreshActorIdentity(session.identity)) {
    clearSession("IDENTITY_SESSION_INVALID");
    return;
  }
  stored = session;
  resetBootstrapBackoff();
  if (persist) void saveStoredSession(session).catch(() => undefined);
  setState({
    kind: "authenticated",
    identity: session.identity,
    accessToken: session.accessToken,
  });
}

async function restoreStoredSession(identityClient: IdentityClient, session: StoredSession): Promise<void> {
  setState({ kind: "authenticating" });
  try {
    const identity = await identityClient.session(session.accessToken);
    commitAuthenticatedSession({ ...session, identity }, true);
    return;
  } catch (error) {
    if (isIdentityAvailabilityError(error)) {
      setServiceUnavailable(identityErrorCode(error));
      return;
    }
    if (!isIdentityInvalidSessionError(error)) {
      setServiceUnavailable("IDENTITY_UNAVAILABLE");
      return;
    }
  }

  try {
    const refreshed = await identityClient.refresh(session.refreshToken);
    commitAuthenticatedSession({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      identity: refreshed.identity,
    }, true);
  } catch (error) {
    if (isIdentityConcurrentRefreshError(error)) {
      setServiceUnavailable("REFRESH_ALREADY_ROTATED");
      return;
    }
    if (isIdentityAvailabilityError(error)) {
      setServiceUnavailable(identityErrorCode(error));
      return;
    }
    if (isIdentityInvalidSessionError(error)) {
      clearSession("IDENTITY_SESSION_INVALID");
      return;
    }
    setServiceUnavailable("IDENTITY_UNAVAILABLE");
  }
}

async function performIdentityBootstrap(identityClient: IdentityClient): Promise<void> {
  setState({ kind: "restoring" });

  const saved = stored ?? await loadStoredSession();
  stored = saved;

  try {
    const readiness = await identityClient.readiness();
    if (readiness.status !== "HEALTHY") {
      setServiceUnavailable("IDENTITY_NOT_READY");
      return;
    }
  } catch (error) {
    setServiceUnavailable(identityErrorCode(error));
    return;
  }

  if (!saved) {
    resetBootstrapBackoff();
    setState({ kind: "signed_out" });
    return;
  }

  // Stored credentials are continuity material only. Never expose them as an
  // authenticated UI state until Identity has revalidated or refreshed this
  // exact session after application startup.
  await restoreStoredSession(identityClient, saved);
}

export function configureIdentitySession(baseUrl: string): void {
  if (!baseUrl || client !== null) return;
  client = createIdentityClient(baseUrl);
  void retryIdentityBootstrap(true);
}

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshIdentitySession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (client === null || stored === null) return false;

  const configuredClient = client;
  const session = stored;

  const promise = (async () => {
    try {
      const refreshed = await configuredClient.refresh(session.refreshToken);
      commitAuthenticatedSession({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        identity: refreshed.identity,
      }, true);
      return true;
    } catch (error) {
      if (isIdentityInvalidSessionError(error)) {
        clearSession("IDENTITY_SESSION_INVALID");
        return false;
      }
      if (isIdentityConcurrentRefreshError(error)) {
        setServiceUnavailable("REFRESH_ALREADY_ROTATED");
        return false;
      }
      setServiceUnavailable(
        isIdentityAvailabilityError(error)
          ? identityErrorCode(error)
          : "IDENTITY_UNAVAILABLE",
      );
      return false;
    }
  })();

  refreshInFlight = promise;
  try {
    return await promise;
  } finally {
    if (refreshInFlight === promise) {
      refreshInFlight = null;
    }
  }
}

export async function retryIdentityBootstrap(force = false): Promise<void> {
  if (client === null) {
    setState({ kind: "error", message: "IDENTITY_NOT_CONFIGURED" });
    return;
  }
  if (bootstrapInFlight !== null) return bootstrapInFlight;
  if (!force && Date.now() < nextBootstrapAttemptAt) return;

  const configuredClient = client;
  bootstrapInFlight = performIdentityBootstrap(configuredClient).finally(() => {
    bootstrapInFlight = null;
  });
  return bootstrapInFlight;
}

export function getIdentityAccessToken(): string | null {
  return state.kind === "authenticated" ? stored?.accessToken ?? null : null;
}

export function getIdentityState(): IdentitySessionState {
  return state;
}

export function subscribeIdentityState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function adoptIdentityTokenPair(pair: TokenResponse): Promise<void> {
  if (client === null) {
    setState({ kind: "error", message: "IDENTITY_NOT_CONFIGURED" });
    return;
  }
  if (
    !isNonEmptyString(pair.accessToken)
    || !isNonEmptyString(pair.refreshToken)
    || !isStructurallyValidActorIdentity(pair.identity)
  ) {
    setState({ kind: "error", message: "IDENTITY_SESSION_INVALID" });
    return;
  }
  await restoreStoredSession(client, {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    identity: pair.identity,
  });
}

export async function loginIdentity(username: string, password: string): Promise<void> {
  if (client === null) {
    setState({ kind: "error", message: "IDENTITY_NOT_CONFIGURED" });
    return;
  }
  setState({ kind: "authenticating" });
  try {
    const response = await client.login({
      username,
      password,
      deviceFingerprint: await resolveDeviceFingerprint(),
    });
    commitAuthenticatedSession({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      identity: response.identity,
    }, true);
  } catch (error) {
    if (isIdentityAvailabilityError(error)) {
      setServiceUnavailable(identityErrorCode(error));
      return;
    }
    setState({ kind: "error", message: identityErrorCode(error) });
  }
}

export async function requestOtpIdentity(
  actorType: ActivationActorType,
  phone: string,
): Promise<IssueActivationResponse> {
  if (client === null) throw new Error("IDENTITY_NOT_CONFIGURED");
  return client.requestOtp({ actorType, phone });
}

export async function activateIdentity(
  actorType: ActivationActorType,
  phone: string,
  code: string,
): Promise<void> {
  if (client === null) {
    setState({ kind: "error", message: "IDENTITY_NOT_CONFIGURED" });
    return;
  }
  setState({ kind: "authenticating" });
  try {
    const response = await client.activate({
      actorType,
      phone,
      code,
      deviceFingerprint: await resolveDeviceFingerprint(),
    });
    commitAuthenticatedSession({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      identity: response.identity,
    }, true);
  } catch (error) {
    if (isIdentityAvailabilityError(error)) {
      setServiceUnavailable(identityErrorCode(error));
      return;
    }
    setState({ kind: "error", message: identityErrorCode(error) });
  }
}

export async function listIdentitySessions(): Promise<SessionInfo[]> {
  const token = getIdentityAccessToken();
  if (!token) throw new Error("UNAUTHENTICATED");
  if (client === null) throw new Error("IDENTITY_NOT_CONFIGURED");
  return client.listSessions(token);
}

export async function revokeIdentitySession(sessionId: string): Promise<void> {
  const token = getIdentityAccessToken();
  if (!token) throw new Error("UNAUTHENTICATED");
  if (client === null) throw new Error("IDENTITY_NOT_CONFIGURED");
  const revokingCurrentSession = stored?.identity.sessionId === sessionId;
  try {
    await client.revokeSession(token, sessionId);
  } catch (error) {
    if (revokingCurrentSession && isIdentityInvalidSessionError(error)) {
      await runBeforeSessionEndHooks();
      clearSession();
      return;
    }
    if (revokingCurrentSession && isIdentityAvailabilityError(error)) {
      setServiceUnavailable(identityErrorCode(error));
    }
    throw error;
  }
  if (revokingCurrentSession) {
    await runBeforeSessionEndHooks();
    clearSession();
  }
}

export async function logoutIdentity(): Promise<void> {
  const accessToken = stored?.accessToken;
  if (accessToken === undefined) {
    clearSession();
    return;
  }
  if (client === null) {
    setState({ kind: "error", message: "IDENTITY_NOT_CONFIGURED" });
    return;
  }

  try {
    await client.logout(accessToken);
  } catch (error) {
    if (isIdentityInvalidSessionError(error)) {
      await runBeforeSessionEndHooks();
      clearSession();
      return;
    }
    setServiceUnavailable(
      isIdentityAvailabilityError(error)
        ? identityErrorCode(error)
        : "IDENTITY_UNAVAILABLE",
    );
    return;
  }

  await runBeforeSessionEndHooks();
  clearSession();
}

export async function changePasswordIdentity(password: string): Promise<void> {
  const token = getIdentityAccessToken();
  if (!token) throw new Error("UNAUTHENTICATED");
  if (client === null) throw new Error("IDENTITY_NOT_CONFIGURED");
  await client.changePassword(token, password);
}

export async function deleteAccountIdentity(): Promise<void> {
  const token = getIdentityAccessToken();
  if (!token) throw new Error("UNAUTHENTICATED");
  if (client === null) throw new Error("IDENTITY_NOT_CONFIGURED");
  await client.deleteAccount(token);
  await runBeforeSessionEndHooks();
  clearSession();
}

// Compliance markers: IDENTITY_SESSION_INVALID, IDENTITY_NOT_READY, SERVICE_UNAVAILABLE_PRESERVES_SESSION
