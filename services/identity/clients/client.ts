import type {
  ActivationChallenge,
  ActivationRequest,
  ActorIdentity,
  LoginRequest,
  OtpRequest,
  RefreshRequest,
  TokenPair,
} from "./generated/identity-types";

export type IdentityClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export type IdentityClient = Readonly<{
  health(): Promise<Readonly<{ service: "identity"; status: "ok" | "not_ready" }>>;
  readiness(): Promise<Readonly<{ service: "identity"; status: "ok" | "not_ready" }>>;
  requestOtp(request: OtpRequest): Promise<ActivationChallenge>;
  activate(request: ActivationRequest): Promise<TokenPair>;
  login(request: LoginRequest): Promise<TokenPair>;
  refresh(request: RefreshRequest): Promise<TokenPair>;
  session(accessToken: string): Promise<ActorIdentity>;
  logout(accessToken: string): Promise<void>;
}>;

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) {
    throw new Error("IDENTITY_BASE_URL_INVALID");
  }
  return value;
}

function resolveUrl(baseUrl: string, pathname: string): string {
  return baseUrl.startsWith("/")
    ? baseUrl + pathname
    : new URL(pathname, baseUrl + "/").toString();
}

function parseErrorPayload(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== "object") {
    return { code: "IDENTITY_ERROR", message: "identity request failed" };
  }
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") {
    return { code: "IDENTITY_ERROR", message: "identity request failed" };
  }
  const code = (nested as { code?: unknown }).code;
  const message = (nested as { message?: unknown }).message;
  return {
    code: typeof code === "string" && code.trim() ? code : "IDENTITY_ERROR",
    message: typeof message === "string" && message.trim() ? message : "identity request failed",
  };
}

export function isIdentityClientError(value: unknown): value is IdentityClientError {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as { kind?: unknown }).kind === "http" || (value as { kind?: unknown }).kind === "network"),
  );
}

export function createIdentityClient(rawBaseUrl: string, timeoutMs = 8_000): IdentityClient {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  async function request<T>(
    pathname: string,
    options: Readonly<{
      method: "GET" | "POST";
      token?: string;
      body?: unknown;
      acceptStatuses?: readonly number[];
    }>,
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
        throw {
          kind: "network",
          message: error instanceof Error ? error.message : "identity network error",
        } satisfies IdentityClientError;
      }

      if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
        const parsed = parseErrorPayload(await response.json().catch(() => null));
        throw {
          kind: "http",
          status: response.status,
          code: parsed.code,
          message: parsed.message,
        } satisfies IdentityClientError;
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
    requestOtp: (body) => request("/auth/otp/request", { method: "POST", body }),
    activate: (body) => request("/auth/activate", { method: "POST", body }),
    login: (body) => request("/auth/login", { method: "POST", body }),
    refresh: (body) => request("/auth/refresh", { method: "POST", body }),
    session: (accessToken) => request("/auth/session", { method: "GET", token: accessToken }),
    logout: (accessToken) => request("/auth/logout", { method: "POST", token: accessToken }),
  };
}
