import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type ActorIdentity,
  type ActorRoleSearchPage,
  type ActorRoleView,
  type ActorType,
  type AttributedMutationContext,
  type Challenge,
  type ControlPanelRole,
  createIdentityClient,
  createIdentityInternalClient,
  type IdentityClientError,
  identityAuthorizesSurface,
  isIdentityClientError,
  type OperatorPasskeyRegistrationResponse,
  type OperatorPermission,
  type OperatorPermissionAccess,
  type OperatorProfileCreateRequest,
  type OperatorProfileGrantResponse,
  type OperatorProfileInvitationResponse,
  type OperatorProfileMutationContext,
  type OperatorProfileMutationRequest,
  type OperatorProfilePage,
  type OperatorProfileResponse,
  type OperatorProfileUpdateRequest,
  type OperatorRoleDetailsUpdateRequest,
  type PasskeyOptions,
  type TokenPair,
  type VersionedMutationContext,
  validateServiceUrl,
  type WebAuthnJSON,
} from "@bthwani/identity";
import { cookies } from "next/headers";

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

function refreshCookieMaxAge(): number {
  return process.env.BTHWANI_ENV === "development" || process.env.BTHWANI_ENV === "test"
    ? 30 * 24 * 60 * 60
    : 60 * 60;
}

function developmentSessionEnabled(): boolean {
  return process.env.BTHWANI_ENV === "development" && process.env.BTHWANI_AUTH_JOURNEY_PROOF !== "1";
}

async function operatorClientInstanceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(deviceCookie)?.value?.trim();
  if (existing && existing.length >= 8) return existing;
  const created = randomUUID();
  store.set(deviceCookie, created, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 });
  return created;
}

function refreshRequestId(refreshToken: string, clientInstanceId: string): string {
  return createHash("sha256").update("identity-refresh-request-v1\0").update(refreshToken).update("\0").update(clientInstanceId).digest("base64url");
}

async function writeTokens(pair: TokenPair, clientInstanceId: string): Promise<void> {
  if (!isControlPanelIdentity(pair.identity)) throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
  const store = await cookies();
  store.set(accessCookie, pair.accessToken, { ...cookieOptions(), expires: new Date(pair.accessExpiresAt) });
  store.set(refreshCookie, pair.refreshToken, { ...cookieOptions(), maxAge: refreshCookieMaxAge() });
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
  return isIdentityClientError(error) && error.kind === "http" && error.status === 401 && error.code === "REFRESH_STALE";
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

export async function listOperatorProfiles(query: string, state: string, sort: "created_asc" | "created_desc", limit: number, cursor: string, context: AttributedMutationContext): Promise<OperatorProfilePage> {
  return identityInternalClient().listOperatorProfiles(query, state, sort, limit, cursor, context);
}

export async function createOperatorProfile(request: OperatorProfileCreateRequest, context: OperatorProfileMutationContext): Promise<OperatorProfileResponse> {
  return identityInternalClient().createOperatorProfile(request, context);
}

export async function updateOperatorProfile(profileId: string, request: OperatorProfileUpdateRequest, context: OperatorProfileMutationContext): Promise<OperatorProfileResponse> {
  return identityInternalClient().updateOperatorProfile(profileId, request, context);
}

export async function updateOperatorRoleDetails(actorId: string, request: OperatorRoleDetailsUpdateRequest, context: AttributedMutationContext): Promise<ActorRoleView> {
  return identityInternalClient().updateOperatorRoleDetails(actorId, request, context);
}

export async function approveOperatorProfile(profileId: string, request: OperatorProfileMutationRequest, context: OperatorProfileMutationContext): Promise<OperatorProfileResponse> {
  return identityInternalClient().approveOperatorProfile(profileId, request, context);
}

export async function grantOperatorProfile(profileId: string, request: OperatorProfileMutationRequest, context: OperatorProfileMutationContext): Promise<OperatorProfileGrantResponse> {
  return identityInternalClient().grantOperatorProfile(profileId, request, context);
}

export async function issueOperatorProfileInvitation(profileId: string, context: AttributedMutationContext): Promise<OperatorProfileInvitationResponse> {
  return identityInternalClient().issueOperatorProfileInvitation(profileId, context);
}

export async function readOperatorPermission(actorId: string, permission: OperatorPermission, context: AttributedMutationContext): Promise<OperatorPermissionAccess> {
  if (!actorId.trim()) throw missingIdentityRole();
  return identityInternalClient().readOperatorPermission(actorId, permission, context);
}

export async function setOperatorPermission(actorId: string, permission: OperatorPermission, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<OperatorPermissionAccess> {
  if (!actorId.trim()) throw missingIdentityRole();
  return identityInternalClient().setOperatorPermission(actorId, permission, enabled, reason, context);
}

async function lookupIdentityRole(phone: string, role: ActorType): Promise<ActorRoleView | null> {
  const page = await identityInternalClient().searchActorRoles(role, phone, undefined, { limit: 2 });
  if (page.items.length === 0) return null;
  if (page.items.length !== 1) throw new Error("IDENTITY_AMBIGUOUS_ROLE_MATCH");
  return page.items[0] ?? null;
}

export async function searchIdentityRoles(role: ActorType, query: string, limit: number, cursor = "", enabled?: boolean, sort: "phone_asc" | "phone_desc" = "phone_asc"): Promise<ActorRoleSearchPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.trim().length > 100 || cursor.length > 512) throw new Error("INVALID_ACTOR_ROLE_SEARCH");
  return identityInternalClient().searchActorRoles(role, query.trim(), enabled, { limit, cursor, sort });
}

export async function readManagedIdentityRole(actorId: string, role: ActorType): Promise<ActorRoleView> {
  const normalizedActorId = actorId.trim();
  if (!normalizedActorId || normalizedActorId.length > 128) throw new Error("INVALID_ACTOR_ROLE_ID");
  return identityInternalClient().readActorRole(normalizedActorId, role);
}

export async function lookupIdentityRoles(phone: string): Promise<ActorRoleView[]> {
  const roles: ActorType[] = ["client", "partner", "captain", "field", "operator"];
  const records = await Promise.all(roles.map((role) => lookupIdentityRole(phone, role)));
  return records.filter((record): record is ActorRoleView => record !== null);
}

function missingIdentityRole(): IdentityClientError {
  return { kind: "http", status: 404, code: "NOT_FOUND", message: "identity role record not found" };
}

export async function setIdentityRoleEnabled(actorId: string, role: ActorType, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void> {
  if (!actorId.trim()) throw missingIdentityRole();
  await identityInternalClient().setActorRoleEnabled(actorId, role, enabled, reason, context);
}

export async function setIdentitySecurityEnabled(actorId: string, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void> {
  if (!actorId.trim()) throw missingIdentityRole();
  await identityInternalClient().setActorSecurityEnabled(actorId, enabled, reason, context);
}

async function createDevelopmentOperatorSession(): Promise<ActorIdentity | null> {
  if (!developmentSessionEnabled()) return null;
  const clientInstanceId = await operatorClientInstanceId();
  try {
    const pair = await identityClient().developmentSession("operator", clientInstanceId);
    await writeTokens(pair, clientInstanceId);
    return pair.identity;
  } catch (error) {
    if (isIdentityClientError(error) && error.kind === "http" && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export async function loginOperatorWithDevelopmentPassword(password: string): Promise<ActorIdentity> {
  const configuredPassword = process.env.CONTROL_PANEL_DEVELOPMENT_PASSWORD;
  if (!developmentSessionEnabled() || !configuredPassword?.trim()) {
    throw localSessionError(404, "DEVELOPMENT_LOGIN_DISABLED", "الدخول المحلي بكلمة المرور غير مفعّل.");
  }

  const suppliedBytes = Buffer.from(password, "utf8");
  const configuredBytes = Buffer.from(configuredPassword, "utf8");
  const matches = suppliedBytes.length === configuredBytes.length && timingSafeEqual(suppliedBytes, configuredBytes);
  if (!matches) throw localSessionError(401, "INVALID_DEVELOPMENT_PASSWORD", "كلمة المرور غير صحيحة.");

  const identity = await createDevelopmentOperatorSession();
  if (!identity) {
    throw localSessionError(503, "DEVELOPMENT_OPERATOR_UNAVAILABLE", "مشغّل التطوير المحلي غير موجود في خدمة الهوية.");
  }
  return identity;
}

export async function readOperatorSession(): Promise<ActorIdentity | null> {
  const store = await cookies();
  const accessToken = store.get(accessCookie)?.value;
  const refreshToken = store.get(refreshCookie)?.value;
  const clientInstanceId = store.get(deviceCookie)?.value;
  if (!accessToken && !refreshToken) return null;

  if (accessToken) {
    const identity = await readOperatorAccessToken(accessToken);
    if (identity) return identity;
  }

  if (!refreshToken || !clientInstanceId) {
    await clearOperatorCookiesBestEffort();
    return null;
  }

  const refreshKey = `${refreshToken ?? ""}:${clientInstanceId ?? ""}`;
  const activeRefresh = refreshInFlight.get(refreshKey);
  if (activeRefresh) return activeRefresh;
  const result = refreshOperatorSession(refreshToken, clientInstanceId);
  refreshInFlight.set(refreshKey, result);
  try { return await result; } finally { refreshInFlight.delete(refreshKey); }
}

export async function readOperatorProfile(): Promise<Readonly<{ phoneE164: string }> | null> {
  const identity = await readOperatorSession();
  if (!identity) return null;

  const actorRole = await identityInternalClient().readActorRole(identity.subject, "operator");
  if (actorRole.actorId !== identity.subject || actorRole.role !== "operator" || !actorRole.phoneE164.trim()) {
    throw localSessionError(503, "OPERATOR_PROFILE_READBACK_MISMATCH", "operator profile could not be verified");
  }
  return { phoneE164: actorRole.phoneE164 };
}

async function readOperatorAccessToken(accessToken: string): Promise<ActorIdentity | null> {
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
    return null;
  }
}

async function refreshOperatorSession(refreshToken: string, clientInstanceId: string): Promise<ActorIdentity | null> {
  let pair: TokenPair;
  const requestId = refreshRequestId(refreshToken, clientInstanceId);
  try {
    pair = await identityClient().refresh({ refreshToken, clientInstanceId, refreshRequestId: requestId });
  } catch (error) {
    if (isRefreshStale(error)) {
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
  } catch (_error) {
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
    if (tokenToRevoke) {
      try {
        await identityClient().logout(tokenToRevoke);
      } catch (error) {
        if (isIdentityClientError(error) && error.kind === "http" && error.status === 401) tokenToRevoke = undefined;
        else remoteError = error;
      }
    }

    if (!tokenToRevoke && !remoteError && refreshToken && clientInstanceId) {
      try {
        const pair = await identityClient().refresh({ refreshToken, clientInstanceId, refreshRequestId: refreshRequestId(refreshToken, clientInstanceId) });
        if (!isControlPanelIdentity(pair.identity)) throw new Error("CONTROL_PANEL_SESSION_SURFACE_MISMATCH");
        await identityClient().logout(pair.accessToken);
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
