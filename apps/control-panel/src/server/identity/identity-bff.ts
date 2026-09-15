import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import {
  createIdentityClient,
  createIdentityInternalClient,
  identityAuthorizesSurface,
  isIdentityClientError,
  type ActorType,
  type ActorIdentity,
  type ActorRoleView,
  type Challenge,
  type PasskeyOptions,
  type WebAuthnJSON,
  type OperatorPasskeyRegistrationResponse,
  type IdentityClientError,
  type OperatorEnrollmentToken,
  type AttributedMutationContext,
  type VersionedMutationContext,
  type ControlPanelRole,
  type TokenPair,
  validateServiceUrl,
} from "@bthwani/identity";

const cookiePrefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
const accessCookie = `${cookiePrefix}bt_identity_access`;
const refreshCookie = `${cookiePrefix}bt_identity_refresh`;
const deviceCookie = `${cookiePrefix}bt_identity_device`;
const refreshInFlight = new Map<string, Promise<ActorIdentity | null>>();

function identityBaseUrl(): string {
  const explicit = process.env.IDENTITY_API_BASE_URL?.trim();
  if (explicit) return validateServiceUrl(explicit, "IDENTITY_API_BASE_URL");
  throw new Error("IDENTITY_API_BASE_URL_REQUIRED");
}

function identityClient() {
  return createIdentityClient(identityBaseUrl());
}

function identityInternalClient() {
  const token = process.env.CONTROL_PANEL_SERVICE_TOKEN?.trim();
  if (!token) throw new Error("CONTROL_PANEL_SERVICE_TOKEN_REQUIRED");
  return createIdentityInternalClient(identityBaseUrl(), token);
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
}

async function operatorClientInstanceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(deviceCookie)?.value?.trim();
  if (existing && existing.length >= 8) return existing;
  const created = randomUUID();
  store.set(deviceCookie, created, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
  return created;
}

async function writeTokens(pair: TokenPair, clientInstanceId: string): Promise<void> {
  if (!isControlPanelIdentity(pair.identity)) throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
  const store = await cookies();
  store.set(accessCookie, pair.accessToken, { ...cookieOptions(), expires: new Date(pair.accessExpiresAt) });
  store.set(refreshCookie, pair.refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 });
  store.set(deviceCookie, clientInstanceId, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
}

function isControlPanelRole(role: ActorType): role is ControlPanelRole {
  return role === "operator";
}

function isControlPanelIdentity(identity: ActorIdentity): boolean {
  return isControlPanelRole(identity.role) && identity.surface === "control-panel" && identityAuthorizesSurface(identity, identity.role, "control-panel");
}

async function clearOperatorCookies(): Promise<void> {
  const store = await cookies();
  for (const key of [accessCookie, refreshCookie, deviceCookie]) store.set(key, "", { ...cookieOptions(), maxAge: 0 });
}

async function clearOperatorCookiesBestEffort(): Promise<void> {
  try {
    await clearOperatorCookies();
  } catch {
    // A confirmed terminal session remains fail-closed even if cookie cleanup is unavailable.
  }
}

function localSessionError(status: number, code: string, message: string): IdentityClientError {
  return { kind: "http", status, code, message };
}

function isTerminalIdentityFailure(error: unknown): boolean {
  return isIdentityClientError(error) && error.kind === "http" && error.status === 401;
}

function isRefreshStale(error: unknown): boolean {
  return isIdentityClientError(error) && error.kind === "http" && error.code === "REFRESH_STALE";
}

async function revokeRefreshedPair(pair: TokenPair): Promise<boolean> {
  try {
    await identityClient().logout(pair.accessToken);
    return true;
  } catch (error) {
    return isTerminalIdentityFailure(error);
  }
}

export async function beginOperatorPasskeyAuthentication(): Promise<PasskeyOptions> {
  return identityClient().beginOperatorPasskeyAuthentication();
}

export async function finishOperatorPasskeyAuthentication(ceremonyId: string, credential: WebAuthnJSON): Promise<ActorIdentity> {
  const clientInstanceId = await operatorClientInstanceId();
  const pair = await identityClient().finishOperatorPasskeyAuthentication({ ceremonyId, credential, clientInstanceId });
  await writeTokens(pair, clientInstanceId);
  return pair.identity;
}

export async function requestOperatorEnrollment(phone: string, operatorEnrollmentToken: string): Promise<Challenge> {
  await operatorClientInstanceId();
  return identityClient().requestOperatorEnrollment({ phone, operatorEnrollmentToken });
}

export async function beginOperatorPasskeyRegistration(phone: string, operatorEnrollmentToken: string, verificationCode: string): Promise<PasskeyOptions> {
  return identityClient().beginOperatorPasskeyRegistration({ phone, operatorEnrollmentToken, verificationCode });
}

export async function finishOperatorPasskeyRegistration(ceremonyId: string, credential: WebAuthnJSON): Promise<OperatorPasskeyRegistrationResponse> {
  const clientInstanceId = await operatorClientInstanceId();
  const result = await identityClient().finishOperatorPasskeyRegistration({ ceremonyId, credential, clientInstanceId });
  await writeTokens(result.tokenPair, clientInstanceId);
  return result;
}

export async function requestOperatorRecovery(phone: string, recoveryCredential: string): Promise<Challenge> {
  await operatorClientInstanceId();
  return identityClient().requestOperatorRecovery({ phone, recoveryCredential });
}

export async function beginOperatorRecoveryPasskeyRegistration(phone: string, recoveryCredential: string, verificationCode: string): Promise<PasskeyOptions> {
  return identityClient().beginOperatorRecoveryPasskeyRegistration({ phone, recoveryCredential, verificationCode });
}

export async function finishOperatorRecoveryPasskeyRegistration(ceremonyId: string, credential: WebAuthnJSON): Promise<OperatorPasskeyRegistrationResponse> {
  const clientInstanceId = await operatorClientInstanceId();
  const result = await identityClient().finishOperatorRecoveryPasskeyRegistration({ ceremonyId, credential, clientInstanceId });
  await writeTokens(result.tokenPair, clientInstanceId);
  return result;
}

export async function issueOperatorEnrollmentToken(phone: string, context: AttributedMutationContext): Promise<OperatorEnrollmentToken> {
  return identityInternalClient().issueOperatorEnrollmentToken({ phoneE164: phone, role: "operator" }, context);
}

export async function provisionOperator(phone: string, context: AttributedMutationContext): Promise<ActorRoleView> {
  return identityInternalClient().provisionActorRole({ phoneE164: phone, role: "operator" }, context);
}

async function lookupIdentityRole(phone: string, role: ActorType): Promise<ActorRoleView | null> {
  const page = await identityInternalClient().searchActorRoles(role, phone);
  if (page.items.length === 0) return null;
  if (page.items.length !== 1) throw new Error("IDENTITY_AMBIGUOUS_ROLE_MATCH");
  return page.items[0] ?? null;
}

export async function lookupIdentityRoles(phone: string): Promise<ActorRoleView[]> {
  const roles: ActorType[] = ["client", "partner", "captain", "field", "operator"];
  const records = await Promise.all(roles.map((role) => lookupIdentityRole(phone, role)));
  return records.filter((record): record is ActorRoleView => record !== null);
}

function missingIdentityRole(): IdentityClientError {
  return { kind: "http", status: 404, code: "NOT_FOUND", message: "identity role record not found" };
}

export async function authorizeIdentityRoleReenrollment(actorId: string, role: ActorType, context: AttributedMutationContext): Promise<void> {
  if (!actorId.trim()) throw missingIdentityRole();
  await identityInternalClient().authorizeActorRoleReenrollment(actorId, role, context);
}

export async function setIdentityRoleEnabled(actorId: string, role: ActorType, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void> {
  if (!actorId.trim()) throw missingIdentityRole();
  await identityInternalClient().setActorRoleEnabled(actorId, role, enabled, reason, context);
}

export async function setIdentitySecurityEnabled(actorId: string, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void> {
  if (!actorId.trim()) throw missingIdentityRole();
  await identityInternalClient().setActorSecurityEnabled(actorId, enabled, reason, context);
}

export async function readOperatorSession(): Promise<ActorIdentity | null> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const clientInstanceId = store.get(deviceCookie)?.value;
  if (!accessToken && !refreshToken) return null;
  const refreshKey = `${refreshToken ?? ""}:${clientInstanceId ?? ""}`;
  const activeRefresh = refreshInFlight.get(refreshKey);
  if (activeRefresh) return activeRefresh;
  const result = readOperatorSessionOnce(store, accessToken, refreshToken, clientInstanceId);
  refreshInFlight.set(refreshKey, result);
  try { return await result; } finally { refreshInFlight.delete(refreshKey); }
}

async function readOperatorSessionOnce(store: Awaited<ReturnType<typeof cookies>>, accessToken?: string, refreshToken?: string, clientInstanceId?: string): Promise<ActorIdentity | null> {
  if (accessToken) {
    try {
      const identity = await identityClient().session(accessToken);
      if (!isControlPanelIdentity(identity)) {
        await clearOperatorCookiesBestEffort();
        return null;
      }
      return identity;
    } catch (error) {
      if (!isIdentityClientError(error) || error.kind === "network") throw error;
      if (error.status !== 401) throw error;
    }
  }

  if (!refreshToken || !clientInstanceId) {
    await clearOperatorCookiesBestEffort();
    return null;
  }

  let pair: TokenPair;
  try {
    pair = await identityClient().refresh({ refreshToken, clientInstanceId });
  } catch (error) {
    if (isRefreshStale(error)) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        const freshStore = await cookies();
        const freshAccessToken = freshStore.get(accessCookie)?.value;
        if (freshAccessToken) {
          try {
            const current = await identityClient().session(freshAccessToken);
            if (isControlPanelIdentity(current)) return current;
          } catch {
            // Continue through the bounded reconciliation window.
          }
        }
      }
      throw localSessionError(409, "REFRESH_CONFLICT", "operator session refresh is being reconciled");
    }
    if (isTerminalIdentityFailure(error)) {
      await clearOperatorCookiesBestEffort();
      return null;
    }
    if (isIdentityClientError(error)) throw error;
    throw localSessionError(503, "IDENTITY_SESSION_RECOVERY_UNKNOWN", "identity session recovery could not be classified");
  }

  try {
    await writeTokens(pair, clientInstanceId);
    return pair.identity;
  } catch (error) {
    if (await revokeRefreshedPair(pair)) {
      await clearOperatorCookiesBestEffort();
      return null;
    }
    throw localSessionError(503, "IDENTITY_SESSION_PERSISTENCE_UNAVAILABLE", "identity session persistence is unavailable");
  }
}

export async function logoutOperator(): Promise<void> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const clientInstanceId = store.get(deviceCookie)?.value;
  let remoteError: unknown = null;
  let tokenToRevoke = accessToken;

  try {
    if (!tokenToRevoke && refreshToken && clientInstanceId) {
      try {
        const pair = await identityClient().refresh({ refreshToken, clientInstanceId });
        if (!isControlPanelIdentity(pair.identity)) throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
        tokenToRevoke = pair.accessToken;
      } catch (error) {
        if (!(isIdentityClientError(error) && error.kind === "http" && error.status === 401)) remoteError = error;
      }
    }
    if (tokenToRevoke && !remoteError) {
      try {
        await identityClient().logout(tokenToRevoke);
      } catch (error) {
        if (!(isIdentityClientError(error) && error.kind === "http" && error.status === 401)) remoteError = error;
      }
    }
  } finally {
    await clearOperatorCookiesBestEffort();
  }
  if (remoteError) throw remoteError;
}

export function identityHttpStatus(error: unknown): number {
  if (!isIdentityClientError(error)) return 500;
  if (error.kind === "network") return 503;
  return error.status;
}

export function identityErrorPayload(error: unknown): Readonly<{ code: string; message: string }> {
  if (!isIdentityClientError(error)) return { code: "IDENTITY_INTERNAL_ERROR", message: "identity request failed" };
  if (error.kind === "network") return { code: "IDENTITY_UNAVAILABLE", message: "identity service is unavailable" };
  const httpError: IdentityClientError & { kind: "http" } = error;
  return { code: httpError.code, message: httpError.message };
}
