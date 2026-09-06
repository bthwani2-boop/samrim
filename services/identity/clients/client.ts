import type {
  ActorIdentity,
  Challenge,
  ClientCredentialProofRequest,
  OperatorEnrollmentToken,
  OperatorEnrollmentTokenIssueRequest,
  ManagedActivationRequest,
  ManagedRecoveryChallengeRequest,
  ManagedRecoveryRequest,
  RecoveryResult,
  ManagedPasswordLoginRequest,
  ManagedChallengeRequest,
  OperatorLoginCompleteRequest,
  OperatorLoginStartRequest,
  PasswordLoginRequest,
  PhoneRequest,
  ProvisionActorRoleRequest,
  ActorRoleView,
  ActorRoleSearchPage,
  ActorType,
  RefreshRequest,
  TokenPair,
} from "./generated/identity-types";
import { identityOperationPaths } from "./generated/identity-operations";

export type IdentityClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export type IdentityClient = Readonly<{
  health(): Promise<Readonly<{ service: "identity"; status: "ok" | "not_ready" }>>;
  readiness(): Promise<Readonly<{ service: "identity"; status: "ok" | "not_ready" }>>;
  requestClientRegistration(request: PhoneRequest): Promise<Challenge>;
  registerClient(request: ClientCredentialProofRequest): Promise<TokenPair>;
  loginClient(request: PasswordLoginRequest): Promise<TokenPair>;
  loginManaged(request: ManagedPasswordLoginRequest): Promise<TokenPair>;
  requestClientRecovery(request: PhoneRequest): Promise<Challenge>;
  recoverClient(request: ClientCredentialProofRequest): Promise<TokenPair>;
  requestManagedActivation(request: ManagedChallengeRequest): Promise<Challenge>;
  activateManaged(request: ManagedActivationRequest): Promise<TokenPair>;
  requestManagedRecovery(request: ManagedRecoveryChallengeRequest): Promise<Challenge>;
  recoverManaged(request: ManagedRecoveryRequest): Promise<RecoveryResult>;
  startOperatorLogin(request: OperatorLoginStartRequest): Promise<Challenge>;
  completeOperatorLogin(request: OperatorLoginCompleteRequest): Promise<TokenPair>;
  refresh(request: RefreshRequest): Promise<TokenPair>;
  session(accessToken: string): Promise<ActorIdentity>;
  logout(accessToken: string): Promise<void>;
}>;

export type MutationOptions = Readonly<{
  expectedVersion?: number | undefined;
  operatorActorId?: string | undefined;
}>;

export type IdentityInternalClient = Readonly<{
  issueOperatorEnrollmentToken(request: OperatorEnrollmentTokenIssueRequest): Promise<OperatorEnrollmentToken>;
  provisionActorRole(request: ProvisionActorRoleRequest): Promise<ActorRoleView>;
  searchActorRoles(role: ActorType, query: string, enabled?: boolean): Promise<ActorRoleSearchPage>;
  setActorRoleEnabled(actorId: string, role: ActorType, enabled: boolean, correlationId: string, reason: string, options?: MutationOptions): Promise<void>;
  setActorSecurityEnabled(actorId: string, enabled: boolean, correlationId: string, reason: string, options?: MutationOptions): Promise<void>;
}>;

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) throw new Error("IDENTITY_BASE_URL_INVALID");
  return value;
}

function resolveUrl(baseUrl: string, pathname: string): string {
  return baseUrl.startsWith("/") ? baseUrl + pathname : new URL(pathname, baseUrl + "/").toString();
}

function parseErrorPayload(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== "object") return { code: "IDENTITY_ERROR", message: "identity request failed" };
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return { code: "IDENTITY_ERROR", message: "identity request failed" };
  const code = (nested as { code?: unknown }).code;
  const message = (nested as { message?: unknown }).message;
  return {
    code: typeof code === "string" && code.trim() ? code : "IDENTITY_ERROR",
    message: typeof message === "string" && message.trim() ? message : "identity request failed",
  };
}

export function isIdentityClientError(value: unknown): value is IdentityClientError {
  return Boolean(value && typeof value === "object" && ((value as { kind?: unknown }).kind === "http" || (value as { kind?: unknown }).kind === "network"));
}

export function createIdentityClient(rawBaseUrl: string, timeoutMs = 8_000): IdentityClient {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  async function request<T>(
    pathname: string,
    options: Readonly<{ method: "GET" | "POST"; token?: string; body?: unknown; acceptStatuses?: readonly number[] }>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(resolveUrl(baseUrl, pathname), {
          method: options.method,
          headers: {
            Accept: "application/json",
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(options.token === undefined ? {} : { Authorization: "Bearer " + options.token }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          ...(baseUrl.startsWith("/") ? { credentials: "include" as const } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        throw { kind: "network", message: error instanceof Error ? error.message : "identity network error" } satisfies IdentityClientError;
      }
      if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
        const parsed = parseErrorPayload(await response.json().catch(() => null));
        throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies IdentityClientError;
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    health: () => request(identityOperationPaths.identityHealth.path, { method: identityOperationPaths.identityHealth.method }),
    readiness: () => request(identityOperationPaths.identityReadiness.path, { method: identityOperationPaths.identityReadiness.method, acceptStatuses: [503] }),
    requestClientRegistration: (body) => request(identityOperationPaths.requestClientRegistrationVerification.path, { method: identityOperationPaths.requestClientRegistrationVerification.method, body }),
    registerClient: (body) => request(identityOperationPaths.registerClient.path, { method: identityOperationPaths.registerClient.method, body }),
    loginClient: (body) => request(identityOperationPaths.loginClient.path, { method: identityOperationPaths.loginClient.method, body }),
    loginManaged: (body) => request(identityOperationPaths.loginManagedRole.path, { method: identityOperationPaths.loginManagedRole.method, body }),
    requestClientRecovery: (body) => request(identityOperationPaths.requestClientRecoveryVerification.path, { method: identityOperationPaths.requestClientRecoveryVerification.method, body }),
    recoverClient: (body) => request(identityOperationPaths.recoverClient.path, { method: identityOperationPaths.recoverClient.method, body }),
    requestManagedActivation: (body) => request(identityOperationPaths.requestManagedActivation.path, { method: identityOperationPaths.requestManagedActivation.method, body }),
    activateManaged: (body) => request(identityOperationPaths.activateManagedRole.path, { method: identityOperationPaths.activateManagedRole.method, body }),
    requestManagedRecovery: (body) => request(identityOperationPaths.requestManagedRecoveryVerification.path, { method: identityOperationPaths.requestManagedRecoveryVerification.method, body }),
    recoverManaged: (body) => request(identityOperationPaths.recoverManagedRole.path, { method: identityOperationPaths.recoverManagedRole.method, body }),
    startOperatorLogin: (body) => request(identityOperationPaths.startOperatorLogin.path, { method: identityOperationPaths.startOperatorLogin.method, body }),
    completeOperatorLogin: (body) => request(identityOperationPaths.completeOperatorLogin.path, { method: identityOperationPaths.completeOperatorLogin.method, body }),
    refresh: (body) => request(identityOperationPaths.refreshSession.path, { method: identityOperationPaths.refreshSession.method, body }),
    session: (accessToken) => request(identityOperationPaths.readCurrentSession.path, { method: identityOperationPaths.readCurrentSession.method, token: accessToken }),
    logout: (accessToken) => request(identityOperationPaths.logoutSession.path, { method: identityOperationPaths.logoutSession.method, token: accessToken }),
  };
}

export function expandPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const val = params[key];
    if (val === undefined) throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(val.trim());
  });
}

export function createIdentityInternalClient(rawBaseUrl: string, serviceToken: string, timeoutMs = 8_000): IdentityInternalClient {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const token = serviceToken.trim();
  if (token.length < 24) throw new Error("IDENTITY_SERVICE_TOKEN_INVALID");

  async function requestNoContent(
    pathname: string,
    correlationId: string,
    reason: string,
    options?: MutationOptions,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(resolveUrl(baseUrl, pathname), {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + token,
            ...(correlationId.trim() ? { "X-Correlation-ID": correlationId.trim() } : {}),
            ...(reason.trim() ? { "X-Reason": reason.trim() } : {}),
            ...(options?.expectedVersion !== undefined ? { "X-Expected-Version": String(options.expectedVersion) } : {}),
            ...(options?.operatorActorId?.trim() ? { "X-Acting-Actor-ID": options.operatorActorId.trim(), "X-Actor-ID": options.operatorActorId.trim() } : {}),
          },
          ...(baseUrl.startsWith("/") ? { credentials: "include" as const } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        throw { kind: "network", message: error instanceof Error ? error.message : "identity network error" } satisfies IdentityClientError;
      }
      if (!response.ok) {
        const parsed = parseErrorPayload(await response.json().catch(() => null));
        throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies IdentityClientError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async function issueToken(body: OperatorEnrollmentTokenIssueRequest): Promise<OperatorEnrollmentToken> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(resolveUrl(baseUrl, identityOperationPaths.issueOperatorEnrollmentToken.path), {
          method: identityOperationPaths.issueOperatorEnrollmentToken.method,
          headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify(body),
          ...(baseUrl.startsWith("/") ? { credentials: "include" as const } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        throw { kind: "network", message: error instanceof Error ? error.message : "identity network error" } satisfies IdentityClientError;
      }
      if (!response.ok) {
        const parsed = parseErrorPayload(await response.json().catch(() => null));
        throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies IdentityClientError;
      }
      return (await response.json()) as OperatorEnrollmentToken;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    issueOperatorEnrollmentToken: issueToken,
    provisionActorRole: async (body) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(resolveUrl(baseUrl, identityOperationPaths.provisionActorRole.path), {
            method: identityOperationPaths.provisionActorRole.method,
            headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify(body),
            ...(baseUrl.startsWith("/") ? { credentials: "include" as const } : {}),
            signal: controller.signal,
          });
        } catch (error) {
          throw { kind: "network", message: error instanceof Error ? error.message : "identity network error" } satisfies IdentityClientError;
        }
        if (!response.ok) {
          const parsed = parseErrorPayload(await response.json().catch(() => null));
          throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies IdentityClientError;
        }
        return (await response.json()) as ActorRoleView;
      } finally {
        clearTimeout(timeout);
      }
    },
    searchActorRoles: async (role, query, enabled) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          const params = new URLSearchParams({ role, q: query, limit: "2" });
          if (enabled !== undefined) params.set("enabled", String(enabled));
          response = await fetch(resolveUrl(baseUrl, identityOperationPaths.searchActorRoles.path + "?" + params.toString()), {
            method: identityOperationPaths.searchActorRoles.method,
            headers: { Accept: "application/json", Authorization: "Bearer " + token },
            ...(baseUrl.startsWith("/") ? { credentials: "include" as const } : {}),
            signal: controller.signal,
          });
        } catch (error) {
          throw { kind: "network", message: error instanceof Error ? error.message : "identity network error" } satisfies IdentityClientError;
        }
        if (!response.ok) {
          const parsed = parseErrorPayload(await response.json().catch(() => null));
          throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies IdentityClientError;
        }
        return (await response.json()) as ActorRoleSearchPage;
      } finally {
        clearTimeout(timeout);
      }
    },
    setActorRoleEnabled: (actorId, role, enabled, correlationId, reason, options) => {
      const op = enabled ? identityOperationPaths.enableActorRole : identityOperationPaths.disableActorRole;
      return requestNoContent(
        expandPath(op.path, { actorId, role }),
        correlationId,
        reason,
        options,
      );
    },
    setActorSecurityEnabled: (actorId, enabled, correlationId, reason, options) => {
      const op = enabled ? identityOperationPaths.enableActorSecurity : identityOperationPaths.disableActorSecurity;
      return requestNoContent(
        expandPath(op.path, { actorId }),
        correlationId,
        reason,
        options,
      );
    },
  };
}
