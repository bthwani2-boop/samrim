import type { ActorRoleView, ManagedActivationRole } from "@bthwani/identity";

type DshClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

const managedRoles = new Set<ManagedActivationRole>(["partner", "captain", "field"]);

function dshBaseUrl(): string {
  const explicit = process.env.DSH_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:58080";
  throw new Error("DSH_API_BASE_URL_REQUIRED");
}

function dshToken(): string {
  const token = process.env.DSH_PLATFORM_CONTROL_SERVICE_TOKEN?.trim();
  if (!token || token.length < 24) throw new Error("DSH_PLATFORM_CONTROL_SERVICE_TOKEN_REQUIRED");
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
  return Boolean(value && typeof value === "object" && ((value as { kind?: unknown }).kind === "http" || (value as { kind?: unknown }).kind === "network"));
}

export function dshErrorPayload(error: unknown): Readonly<{ code: string; message: string }> {
  if (!isDshClientError(error)) return { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
  if (error.kind === "network") return { code: "DSH_UNAVAILABLE", message: "dsh service is unavailable" };
  return { code: error.code, message: error.message };
}

export function dshHttpStatus(error: unknown): number {
  if (!isDshClientError(error)) return 502;
  return error.kind === "network" ? 502 : error.status;
}

export async function provisionManagedRole(phone: string, role: ManagedActivationRole): Promise<ActorRoleView> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${dshBaseUrl()}/dsh/managed-roles/provision`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${dshToken()}`,
        },
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
