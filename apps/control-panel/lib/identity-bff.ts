import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import {
  createIdentityClient,
  identityAuthorizesSurface,
  isIdentityClientError,
  type ActorIdentity,
  type Challenge,
  type IdentityClientError,
  type TokenPair,
} from "@bthwani/identity";

const accessCookie = "bt_identity_access";
const refreshCookie = "bt_identity_refresh";
const deviceCookie = "bt_identity_device";

function identityBaseUrl(): string {
  const explicit = process.env.IDENTITY_API_BASE_URL?.trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:18082";
  throw new Error("IDENTITY_API_BASE_URL_REQUIRED");
}

function identityClient() {
  return createIdentityClient(identityBaseUrl());
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
  if (!identityAuthorizesSurface(pair.identity, "operator", "control-panel")) {
    throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
  }
  const store = await cookies();
  store.set(accessCookie, pair.accessToken, { ...cookieOptions(), expires: new Date(pair.accessExpiresAt) });
  store.set(refreshCookie, pair.refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 });
  store.set(deviceCookie, deviceFingerprint, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
}

export async function clearOperatorCookies(): Promise<void> {
  const store = await cookies();
  for (const key of [accessCookie, refreshCookie, deviceCookie]) {
    store.set(key, "", { ...cookieOptions(), maxAge: 0 });
  }
}

export async function startOperatorLogin(phone: string, password: string): Promise<Challenge> {
  await operatorDeviceFingerprint();
  return identityClient().startOperatorLogin({ phone, password });
}

export async function completeOperatorLogin(phone: string, code: string): Promise<ActorIdentity> {
  const deviceFingerprint = await operatorDeviceFingerprint();
  const pair = await identityClient().completeOperatorLogin({ phone, code, deviceFingerprint });
  await writeTokens(pair, deviceFingerprint);
  return pair.identity;
}

export async function readOperatorSession(): Promise<ActorIdentity | null> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const deviceFingerprint = store.get(deviceCookie)?.value;
  if (!accessToken && !refreshToken) return null;

  if (accessToken) {
    try {
      const identity = await identityClient().session(accessToken);
      if (!identityAuthorizesSurface(identity, "operator", "control-panel")) {
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
        if (!identityAuthorizesSurface(pair.identity, "operator", "control-panel")) {
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
