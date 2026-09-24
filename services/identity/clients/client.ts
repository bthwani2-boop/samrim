import { identityOperationPaths } from "./generated/identity-operations";
import type {
  ActorIdentity,
  ActorRoleSearchPage,
  ActorRoleView,
  ActorType,
  Challenge,
  ClientCredentialProofRequest,
  ClientRecoveryProofRequest,
  ManagedActivationRequest,
  ManagedChallengeRequest,
  ManagedPasswordLoginRequest,
  OperatorEnrollmentRequest,
  OperatorEnrollmentToken,
  OperatorEnrollmentTokenIssueRequest,
  OperatorPasskeyAuthenticationFinishRequest,
  OperatorPasskeyRecoveryFinishRequest,
  OperatorPasskeyRecoveryRegistrationOptionsRequest,
  OperatorPasskeyRegistrationFinishRequest,
  OperatorPasskeyRegistrationOptionsRequest,
  OperatorPasskeyRegistrationResponse,
  OperatorPermission,
  OperatorPermissionAccess,
  OperatorRecoveryRequest,
  PasskeyOptions,
  PasswordLoginRequest,
  PhoneRequest,
  ProvisionActorRoleRequest,
  RecoveryResult,
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
  recoverClient(request: ClientRecoveryProofRequest): Promise<RecoveryResult>;
  requestManagedActivation(request: ManagedChallengeRequest): Promise<Challenge>;
  activateManaged(request: ManagedActivationRequest): Promise<TokenPair>;
  requestOperatorEnrollment(request: OperatorEnrollmentRequest): Promise<Challenge>;
  beginOperatorPasskeyRegistration(request: OperatorPasskeyRegistrationOptionsRequest): Promise<PasskeyOptions>;
  finishOperatorPasskeyRegistration(request: OperatorPasskeyRegistrationFinishRequest): Promise<OperatorPasskeyRegistrationResponse>;
  beginOperatorPasskeyAuthentication(): Promise<PasskeyOptions>;
  finishOperatorPasskeyAuthentication(request: OperatorPasskeyAuthenticationFinishRequest): Promise<TokenPair>;
  requestOperatorRecovery(request: OperatorRecoveryRequest): Promise<Challenge>;
  beginOperatorRecoveryPasskeyRegistration(request: OperatorPasskeyRecoveryRegistrationOptionsRequest): Promise<PasskeyOptions>;
  finishOperatorRecoveryPasskeyRegistration(request: OperatorPasskeyRecoveryFinishRequest): Promise<OperatorPasskeyRegistrationResponse>;
  refresh(request: RefreshRequest): Promise<TokenPair>;
  developmentSession(role: ActorType, clientInstanceId: string): Promise<TokenPair>;
  session(accessToken: string): Promise<ActorIdentity>;
  logout(accessToken: string): Promise<void>;
}>;

export type AttributedMutationContext = Readonly<{
  operatorActorId: string;
  correlationId: string;
}>;

export type VersionedMutationContext = AttributedMutationContext & Readonly<{
  expectedVersion: number;
}>;

export type ReenrollmentMutationContext = AttributedMutationContext & Readonly<{
  expectedActorVersion: number;
  expectedRoleVersion: number;
  reason: string;
}>;

export type IdentityInternalClient = Readonly<{
  issueOperatorEnrollmentToken(request: OperatorEnrollmentTokenIssueRequest, context: AttributedMutationContext): Promise<OperatorEnrollmentToken>;
  provisionActorRole(request: ProvisionActorRoleRequest, context: AttributedMutationContext): Promise<ActorRoleView>;
  searchActorRoles(role: ActorType, query: string, enabled?: boolean, page?: Readonly<{ limit?: number; cursor?: string }>): Promise<ActorRoleSearchPage>;
  readActorRole(actorId: string, role: ActorType): Promise<ActorRoleView>;
  readOperatorPermission(actorId: string, permission: OperatorPermission, context: AttributedMutationContext): Promise<OperatorPermissionAccess>;
  setOperatorPermission(actorId: string, permission: OperatorPermission, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<OperatorPermissionAccess>;
  authorizeActorRoleReenrollment(actorId: string, role: ActorType, context: ReenrollmentMutationContext): Promise<void>;
  setActorRoleEnabled(actorId: string, role: ActorType, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void>;
  setActorSecurityEnabled(actorId: string, enabled: boolean, reason: string, context: VersionedMutationContext): Promise<void>;
}>;

function normalizeBaseUrl(raw: string): string {
  let value = raw.trim();
  while (value.endsWith("/")) value = value.slice(0, -1);
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
          cache: "no-store",
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
    requestOperatorEnrollment: (body) => request(identityOperationPaths.requestOperatorEnrollment.path, { method: identityOperationPaths.requestOperatorEnrollment.method, body }),
    beginOperatorPasskeyRegistration: (body) => request(identityOperationPaths.beginOperatorPasskeyRegistration.path, { method: identityOperationPaths.beginOperatorPasskeyRegistration.method, body }),
    finishOperatorPasskeyRegistration: (body) => request(identityOperationPaths.finishOperatorPasskeyRegistration.path, { method: identityOperationPaths.finishOperatorPasskeyRegistration.method, body }),
    beginOperatorPasskeyAuthentication: () => request(identityOperationPaths.beginOperatorPasskeyAuthentication.path, { method: identityOperationPaths.beginOperatorPasskeyAuthentication.method }),
    finishOperatorPasskeyAuthentication: (body) => request(identityOperationPaths.finishOperatorPasskeyAuthentication.path, { method: identityOperationPaths.finishOperatorPasskeyAuthentication.method, body }),
    requestOperatorRecovery: (body) => request(identityOperationPaths.requestOperatorRecovery.path, { method: identityOperationPaths.requestOperatorRecovery.method, body }),
    beginOperatorRecoveryPasskeyRegistration: (body) => request(identityOperationPaths.beginOperatorRecoveryPasskeyRegistration.path, { method: identityOperationPaths.beginOperatorRecoveryPasskeyRegistration.method, body }),
    finishOperatorRecoveryPasskeyRegistration: (body) => request(identityOperationPaths.finishOperatorRecoveryPasskeyRegistration.path, { method: identityOperationPaths.finishOperatorRecoveryPasskeyRegistration.method, body }),
    refresh: (body) => request(identityOperationPaths.refreshSession.path, { method: identityOperationPaths.refreshSession.method, body }),
    developmentSession: (role, clientInstanceId) => request(identityOperationPaths.createDevelopmentSession.path, { method: identityOperationPaths.createDevelopmentSession.method, body: { role, clientInstanceId } }),
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

function validateAttributedMutationContext(context: AttributedMutationContext): void {
  if (!context.operatorActorId.trim() || !context.correlationId.trim()) throw new Error("IDENTITY_MUTATION_CONTEXT_INVALID");
}

function validateVersionedMutationContext(context: VersionedMutationContext): void {
  validateAttributedMutationContext(context);
  if (!Number.isInteger(context.expectedVersion) || context.expectedVersion < 1) throw new Error("IDENTITY_MUTATION_VERSION_INVALID");
}

function validateReenrollmentMutationContext(context: ReenrollmentMutationContext): void {
  validateAttributedMutationContext(context);
  if (!Number.isSafeInteger(context.expectedActorVersion) || context.expectedActorVersion < 1 || !Number.isSafeInteger(context.expectedRoleVersion) || context.expectedRoleVersion < 1) throw new Error("IDENTITY_REENROLLMENT_VERSION_INVALID");
  const reasonLength = Array.from(context.reason.trim()).length;
  if (reasonLength < 5 || reasonLength > 500) throw new Error("IDENTITY_REENROLLMENT_REASON_INVALID");
}

export function createIdentityInternalClient(rawBaseUrl: string, serviceToken: string, timeoutMs = 8_000): IdentityInternalClient {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const token = serviceToken.trim();
  if (token.length < 24) throw new Error("IDENTITY_SERVICE_TOKEN_INVALID");

  async function readActorRole(actorId: string, role: ActorType): Promise<ActorRoleView> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(resolveUrl(baseUrl, expandPath(identityOperationPaths.readActorRole.path, { actorId, role })), {
          method: identityOperationPaths.readActorRole.method,
          cache: "no-store",
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
      return (await response.json()) as ActorRoleView;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestNoContent(
    pathname: string,
    reason: string,
    context: VersionedMutationContext,
  ): Promise<void> {
    validateVersionedMutationContext(context);
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
            "X-Correlation-ID": context.correlationId.trim(),
            ...(reason.trim() ? { "X-Reason": reason.trim() } : {}),
            "X-Expected-Version": String(context.expectedVersion),
            "X-Acting-Actor-ID": context.operatorActorId.trim(),
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

  async function requestOperatorPermission(
    actorId: string,
    permission: OperatorPermission,
    method: "GET" | "PUT",
    context: AttributedMutationContext | VersionedMutationContext,
    enabled?: boolean,
    reason = "",
  ): Promise<OperatorPermissionAccess> {
    if (method === "PUT") {
      validateVersionedMutationContext(context as VersionedMutationContext);
      const reasonLength = Array.from(reason.trim()).length;
      if (reasonLength < 5 || reasonLength > 500) throw new Error("IDENTITY_OPERATOR_PERMISSION_REASON_INVALID");
    } else {
      validateAttributedMutationContext(context);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        const operation = method === "PUT" ? identityOperationPaths.setOperatorPermission : identityOperationPaths.readOperatorPermission;
        response = await fetch(resolveUrl(baseUrl, expandPath(operation.path, { actorId, permission })), {
          method,
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + token,
            "X-Acting-Actor-ID": context.operatorActorId.trim(),
            ...(method === "PUT" ? {
              "Content-Type": "application/json",
              "X-Correlation-ID": context.correlationId.trim(),
              "X-Expected-Version": String((context as VersionedMutationContext).expectedVersion),
              "X-Reason": reason.trim(),
            } : {}),
          },
          ...(method === "PUT" ? { body: JSON.stringify({ enabled }) } : {}),
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
      return (await response.json()) as OperatorPermissionAccess;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function issueToken(body: OperatorEnrollmentTokenIssueRequest, context: AttributedMutationContext): Promise<OperatorEnrollmentToken> {
    validateAttributedMutationContext(context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(resolveUrl(baseUrl, identityOperationPaths.issueOperatorEnrollmentToken.path), {
          method: identityOperationPaths.issueOperatorEnrollmentToken.method,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            "X-Correlation-ID": context.correlationId.trim(),
            "X-Acting-Actor-ID": context.operatorActorId.trim(),
          },
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

  async function requestReenrollmentNoContent(pathname: string, context: ReenrollmentMutationContext): Promise<void> {
    validateReenrollmentMutationContext(context);
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
            "X-Correlation-ID": context.correlationId.trim(),
            "X-Acting-Actor-ID": context.operatorActorId.trim(),
            "X-Expected-Version": String(context.expectedRoleVersion),
            "X-Expected-Actor-Version": String(context.expectedActorVersion),
            "X-Reason": context.reason.trim(),
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
    issueOperatorEnrollmentToken: issueToken,
    provisionActorRole: async (body, context) => {
      validateAttributedMutationContext(context);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(resolveUrl(baseUrl, identityOperationPaths.provisionActorRole.path), {
            method: identityOperationPaths.provisionActorRole.method,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
              "X-Correlation-ID": context.correlationId.trim(),
              "X-Acting-Actor-ID": context.operatorActorId.trim(),
            },
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
    readActorRole,
    searchActorRoles: async (role, query, enabled, page) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          const params = new URLSearchParams({ role, q: query, limit: String(page?.limit ?? 25) });
          if (page?.cursor) params.set("cursor", page.cursor);
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
    readOperatorPermission: (actorId, permission, context) => requestOperatorPermission(actorId, permission, "GET", context),
    setOperatorPermission: (actorId, permission, enabled, reason, context) => requestOperatorPermission(actorId, permission, "PUT", context, enabled, reason),
    authorizeActorRoleReenrollment: (actorId, role, context) =>
      requestReenrollmentNoContent(expandPath(identityOperationPaths.authorizeManagedRoleReenrollment.path, { actorId, role }), context),
    setActorRoleEnabled: (actorId, role, enabled, reason, context) => {
      const op = enabled ? identityOperationPaths.enableActorRole : identityOperationPaths.disableActorRole;
      return requestNoContent(
        expandPath(op.path, { actorId, role }),
        reason,
        context,
      );
    },
    setActorSecurityEnabled: (actorId, enabled, reason, context) => {
      const op = enabled ? identityOperationPaths.enableActorSecurity : identityOperationPaths.disableActorSecurity;
      return requestNoContent(
        expandPath(op.path, { actorId }),
        reason,
        context,
      );
    },
  };
}
