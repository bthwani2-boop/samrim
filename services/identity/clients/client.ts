import type {
  ActorIdentity,
  Challenge,
  ClientCredentialProofRequest,
  ManagedActivationCode,
  ManagedActivationCodeIssueRequest,
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

export type IdentityInternalClient = Readonly<{
  issueManagedActivationCode(request: ManagedActivationCodeIssueRequest): Promise<ManagedActivationCode>;
  provisionActorRole(request: ProvisionActorRoleRequest): Promise<ActorRoleView>;
  searchActorRoles(role: ActorType, query: string, enabled?: boolean): Promise<ActorRoleSearchPage>;
  setActorRoleEnabled(actorId: string, role: ActorType, enabled: boolean, correlationId: string, reason: string): Promise<void>;
  setActorSecurityEnabled(actorId: string, enabled: boolean, correlationId: string, reason: string): Promise<void>;
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
    health: () => request("/identity/health", { method: "GET" }),
    readiness: () => request("/identity/readiness", { method: "GET", acceptStatuses: [503] }),
    requestClientRegistration: (body) => request("/auth/client/registration/request", { method: "POST", body }),
    registerClient: (body) => request("/auth/client/register", { method: "POST", body }),
    loginClient: (body) => request("/auth/client/login", { method: "POST", body }),
    loginManaged: (body) => request("/auth/managed/login", { method: "POST", body }),
    requestClientRecovery: (body) => request("/auth/client/recovery/request", { method: "POST", body }),
    recoverClient: (body) => request("/auth/client/recover", { method: "POST", body }),
    requestManagedActivation: (body) => request("/auth/managed/activation/request", { method: "POST", body }),
    activateManaged: (body) => request("/auth/managed/activate", { method: "POST", body }),
    requestManagedRecovery: (body) => request("/auth/managed/recovery/request", { method: "POST", body }),
    recoverManaged: (body) => request("/auth/managed/recover", { method: "POST", body }),
    startOperatorLogin: (body) => request("/auth/operator/login/start", { method: "POST", body }),
    completeOperatorLogin: (body) => request("/auth/operator/login/complete", { method: "POST", body }),
    refresh: (body) => request("/auth/refresh", { method: "POST", body }),
    session: (accessToken) => request("/auth/session", { method: "GET", token: accessToken }),
    logout: (accessToken) => request("/auth/logout", { method: "POST", token: accessToken }),
  };
}

export function createIdentityInternalClient(rawBaseUrl: string, serviceToken: string, timeoutMs = 8_000): IdentityInternalClient {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const token = serviceToken.trim();
  if (token.length < 24) throw new Error("IDENTITY_SERVICE_TOKEN_INVALID");

  async function requestNoContent(pathname: string, correlationId: string, reason: string): Promise<void> {
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

  return {
    issueManagedActivationCode: async (body) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(resolveUrl(baseUrl, "/internal/managed-activation-codes"), {
            method: "POST",
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
        return (await response.json()) as ManagedActivationCode;
      } finally {
        clearTimeout(timeout);
      }
    },
    provisionActorRole: async (body) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(resolveUrl(baseUrl, "/internal/actor-roles/provision"), {
            method: "POST",
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
          response = await fetch(resolveUrl(baseUrl, "/internal/actor-roles/search?" + params.toString()), {
            method: "GET",
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
    setActorRoleEnabled: (actorId, role, enabled, correlationId, reason) => requestNoContent(
      "/internal/actors/" + encodeURIComponent(actorId.trim()) + "/roles/" + encodeURIComponent(role) + "/" + (enabled ? "enable" : "disable"),
      correlationId,
      reason,
    ),
    setActorSecurityEnabled: (actorId, enabled, correlationId, reason) => requestNoContent(
      "/internal/actors/" + encodeURIComponent(actorId.trim()) + "/security/" + (enabled ? "enable" : "disable"),
      correlationId,
      reason,
    ),
  };
}
