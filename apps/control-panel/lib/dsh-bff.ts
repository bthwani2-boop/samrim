import { validateServiceUrl, type ManagedActivationRole } from "@bthwani/identity";
import { type ActorRoleView, type ManagedRole, type ManagedRoleStatusResponse, dshOperationPaths } from "@bthwani/dsh";

type DshClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>
  | Readonly<{ kind: "config"; message: string }>;

export type ManagedRoleStatus = ManagedRoleStatusResponse;

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field"]);

function dshBaseUrl(): string {
  const explicit = process.env.DSH_API_BASE_URL?.trim();
  if (explicit) {
    try {
      return validateServiceUrl(explicit, "DSH_API_BASE_URL");
    } catch {
      throw { kind: "config", message: "dsh service must use HTTPS" } satisfies DshClientError;
    }
  }
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:58080";
  throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
}

function dshToken(): string {
  const token = process.env.DSH_PLATFORM_CONTROL_SERVICE_TOKEN?.trim();
  if (!token || token.length < 24) throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
  return token;
}

function parseErrorPayload(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== "object") return { code: "DSH_ERROR", message: "dsh request failed" };
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return { code: "DSH_ERROR", message: "dsh request failed" };
  const code = (nested as { code?: unknown }).code;
  const message = (nested as { message?: unknown }).message;
  return {
    code: typeof code === "string" && code.trim() ? code : "DSH_ERROR",
    message: typeof message === "string" && message.trim() ? message : "dsh request failed",
  };
}

export function isDshClientError(value: unknown): value is DshClientError {
  return Boolean(value && typeof value === "object" && (["http", "network", "config"] as const).includes((value as { kind?: unknown }).kind as "http" | "network" | "config"));
}

export function dshErrorPayload(error: unknown): Readonly<{ code: string; message: string }> {
  if (!isDshClientError(error)) return { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
  if (error.kind === "network") return { code: "DSH_UNAVAILABLE", message: "dsh service is unavailable" };
  if (error.kind === "config") return { code: "DSH_CONFIG_ERROR", message: "dsh service configuration is incomplete" };
  return { code: error.code, message: error.message };
}

export function dshHttpStatus(error: unknown): number {
  if (!isDshClientError(error)) return 502;
  return error.kind === "network" ? 502 : error.kind === "config" ? 500 : error.status;
}

export async function provisionManagedRole(
  phone: string,
  role: ManagedActivationRole,
  options?: { operatorActorId?: string; correlationId?: string },
): Promise<ActorRoleView> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (options?.operatorActorId?.trim()) {
        headers["X-Acting-Actor-ID"] = options.operatorActorId.trim();
      }
      if (options?.correlationId?.trim()) {
        headers["X-Correlation-ID"] = options.correlationId.trim();
      }
      response = await fetch(`${baseUrl}${dshOperationPaths.provisionManagedRole.path}`, {
        method: dshOperationPaths.provisionManagedRole.method,
        headers,
        body: JSON.stringify({ phoneE164: phone, role }),
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return (await response.json()) as ActorRoleView;
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupManagedRoleStatus(phone: string, role: "partner" | "captain" | "field"): Promise<ManagedRoleStatus> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const params = new URLSearchParams({ phoneE164: phone, role });
      response = await fetch(`${baseUrl}${dshOperationPaths.getManagedRoleStatus.path}?${params.toString()}`, {
        method: dshOperationPaths.getManagedRoleStatus.method,
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return (await response.json()) as ManagedRoleStatus;
  } finally {
    clearTimeout(timeout);
  }
}

export async function authorizeManagedReenrollment(
  phone: string,
  role: "partner" | "captain" | "field",
  correlationId: string,
  options?: { operatorActorId?: string },
): Promise<void> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Correlation-ID": correlationId,
      };
      if (options?.operatorActorId?.trim()) {
        headers["X-Acting-Actor-ID"] = options.operatorActorId.trim();
      }
      response = await fetch(`${baseUrl}${dshOperationPaths.reenrollManagedRoleByPhone.path}`, {
        method: dshOperationPaths.reenrollManagedRoleByPhone.method,
        headers,
        body: JSON.stringify({ phoneE164: phone, role }),
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function setManagedRoleEnabled(
  phone: string,
  role: "partner" | "captain" | "field",
  enabled: boolean,
  reason: string,
  correlationId: string,
  options?: { operatorActorId?: string; expectedVersion?: number },
): Promise<void> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Correlation-ID": correlationId,
      };
      if (options?.operatorActorId?.trim()) {
        headers["X-Acting-Actor-ID"] = options.operatorActorId.trim();
      }
      if (options?.expectedVersion !== undefined) {
        if (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 1) {
          throw new Error("INVALID_EXPECTED_VERSION");
        }
        headers["X-Expected-Version"] = String(options.expectedVersion);
      }
      const operation = enabled ? dshOperationPaths.enableManagedRole : dshOperationPaths.disableManagedRole;
      response = await fetch(`${baseUrl}${operation.path}`, {
        method: operation.method,
        headers,
        body: JSON.stringify({ phoneE164: phone, role, reason }),
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
  } finally {
    clearTimeout(timeout);
  }
}
