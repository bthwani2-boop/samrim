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
  type IdentityClientError,
  type ManagedActivationCode,
  type ControlPanelRole,
  type RecoveryResult,
  type TokenPair,
} from "@bthwani/identity";

const cookiePrefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
const accessCookie = `${cookiePrefix}bt_identity_access`;
const refreshCookie = `${cookiePrefix}bt_identity_refresh`;
const deviceCookie = `${cookiePrefix}bt_identity_device`;
const refreshInFlight = new Map<string, Promise<ActorIdentity | null>>();

function identityBaseUrl(): string {
  const explicit = process.env.IDENTITY_API_BASE_URL?.trim();
  if (explicit) {
    if (process.env.NODE_ENV === "production" && !explicit.startsWith("https://")) throw new Error("IDENTITY_API_HTTPS_REQUIRED");
    return explicit;
  }
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:18082";
  throw new Error("IDENTITY_API_BASE_URL_REQUIRED");
}

function identityClient() {
  return createIdentityClient(identityBaseUrl());
}

function identityInternalClient() {
  const token = process.env.IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN?.trim();
  if (!token) throw new Error("IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN_REQUIRED");
  return createIdentityInternalClient(identityBaseUrl(), token);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
}

async function operatorDeviceFingerprint(): Promise<string> {
  const store = await cookies();
  const existing = store.get(deviceCookie)?.value?.trim();
  if (existing && existing.length >= 8) return existing;
  const created = randomUUID();
  store.set(deviceCookie, created, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
  return created;
}

async function writeTokens(pair: TokenPair, deviceFingerprint: string): Promise<void> {
	if (!isControlPanelIdentity(pair.identity)) {
		throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
	}
  const store = await cookies();
  store.set(accessCookie, pair.accessToken, { ...cookieOptions(), expires: new Date(pair.accessExpiresAt) });
  store.set(refreshCookie, pair.refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 });
  store.set(deviceCookie, deviceFingerprint, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
}

function isControlPanelRole(role: ActorType): role is ControlPanelRole {
  return role === "operator" || role === "platform_owner";
}

function isControlPanelIdentity(identity: ActorIdentity): boolean {
  return isControlPanelRole(identity.role) && identity.surface === "control-panel" && identityAuthorizesSurface(identity, identity.role, "control-panel");
}

export async function clearOperatorCookies(): Promise<void> {
  const store = await cookies();
  for (const key of [accessCookie, refreshCookie, deviceCookie]) {
    store.set(key, "", { ...cookieOptions(), maxAge: 0 });
  }
}

export async function startOperatorLogin(phone: string, password: string, role: ControlPanelRole): Promise<Challenge> {
  await operatorDeviceFingerprint();
  return identityClient().startOperatorLogin({ phone, password, role });
}

export async function completeOperatorLogin(phone: string, code: string, role: ControlPanelRole): Promise<ActorIdentity> {
  const deviceFingerprint = await operatorDeviceFingerprint();
  const pair = await identityClient().completeOperatorLogin({ phone, code, role, deviceFingerprint });
  await writeTokens(pair, deviceFingerprint);
  return pair.identity;
}

export async function requestOperatorActivation(phone: string, activationCode: string): Promise<Challenge> {
  await operatorDeviceFingerprint();
  return identityClient().requestManagedActivation({ phone, role: "operator", activationCode });
}

export async function completeOperatorActivation(phone: string, activationCode: string, verificationCode: string, password: string): Promise<ActorIdentity> {
  const deviceFingerprint = await operatorDeviceFingerprint();
  const pair = await identityClient().activateManaged({ phone, role: "operator", activationCode, verificationCode, password, deviceFingerprint });
  await writeTokens(pair, deviceFingerprint);
  return pair.identity;
}

export async function requestOperatorRecovery(phone: string): Promise<Challenge> {
  await operatorDeviceFingerprint();
  return identityClient().requestManagedRecovery({ phone, role: "operator" });
}

export async function completeOperatorRecovery(phone: string, code: string, password: string): Promise<RecoveryResult> {
  return identityClient().recoverManaged({ phone, role: "operator", code, password });
}

export async function issueManagedActivationCode(phone: string): Promise<ManagedActivationCode> {
  return identityInternalClient().issueManagedActivationCode({ phoneE164: phone, role: "operator" });
}

export async function provisionOperator(phone: string): Promise<ActorRoleView> {
  return identityInternalClient().provisionActorRole({ phoneE164: phone, role: "operator" });
}

export async function lookupIdentityRole(phone: string, role: ActorType): Promise<ActorRoleView | null> {
  const page = await identityInternalClient().searchActorRoles(role, phone);
  if (page.items.length === 0) return null;
  if (page.items.length !== 1) throw new Error("IDENTITY_AMBIGUOUS_ROLE_MATCH");
  return page.items[0] ?? null;
}

function missingIdentityRole(): IdentityClientError {
  return { kind: "http", status: 404, code: "NOT_FOUND", message: "identity role record not found" };
}

export async function setIdentityRoleEnabled(phone: string, role: ActorType, enabled: boolean, reason: string): Promise<void> {
  const record = await lookupIdentityRole(phone, role);
  if (!record) throw missingIdentityRole();
  await identityInternalClient().setActorRoleEnabled(record.actorId, role, enabled, randomUUID(), reason);
}

export async function setIdentitySecurityEnabled(phone: string, role: ActorType, enabled: boolean, reason: string): Promise<void> {
  const record = await lookupIdentityRole(phone, role);
  if (!record) throw missingIdentityRole();
  await identityInternalClient().setActorSecurityEnabled(record.actorId, enabled, randomUUID(), reason);
}

export async function readOperatorSession(): Promise<ActorIdentity | null> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const deviceFingerprint = store.get(deviceCookie)?.value;
  if (!accessToken && !refreshToken) return null;
  const refreshKey = `${refreshToken ?? ""}:${deviceFingerprint ?? ""}`;
  const activeRefresh = refreshInFlight.get(refreshKey);
  if (activeRefresh) return activeRefresh;
  const result = readOperatorSessionOnce(store, accessToken, refreshToken, deviceFingerprint);
  refreshInFlight.set(refreshKey, result);
  try { return await result; } finally { refreshInFlight.delete(refreshKey); }
}

async function readOperatorSessionOnce(store: Awaited<ReturnType<typeof cookies>>, accessToken?: string, refreshToken?: string, deviceFingerprint?: string): Promise<ActorIdentity | null> {

  if (accessToken) {
    try {
      const identity = await identityClient().session(accessToken);
      if (!isControlPanelIdentity(identity)) {
        await clearOperatorCookies();
        return null;
      }
      return identity;
    } catch (error) {
      if (!isIdentityClientError(error) || error.kind === "network") throw error;
      if (error.status !== 401) throw error;
    }
  }

  if (!refreshToken || !deviceFingerprint) {
    await clearOperatorCookies();
    return null;
  }

  try {
    const pair = await identityClient().refresh({ refreshToken, deviceFingerprint });
    await writeTokens(pair, deviceFingerprint);
    return pair.identity;
  } catch (error) {
    if (isIdentityClientError(error) && error.kind === "network") throw error;
    await clearOperatorCookies();
    return null;
  }
}

export async function logoutOperator(): Promise<void> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const deviceFingerprint = store.get(deviceCookie)?.value;
  let remoteError: unknown = null;
  let tokenToRevoke = accessToken;

  try {
    if (!tokenToRevoke && refreshToken && deviceFingerprint) {
      try {
        const pair = await identityClient().refresh({ refreshToken, deviceFingerprint });
        if (!isControlPanelIdentity(pair.identity)) {
          throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
        }
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
    await clearOperatorCookies();
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
