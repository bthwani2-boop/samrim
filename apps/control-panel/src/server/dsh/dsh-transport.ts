import type { MediaProvenanceInput } from "@bthwani/dsh";
import { validateServiceUrl } from "@bthwani/identity";

export type DshClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>
  | Readonly<{ kind: "config"; message: string }>;

export type DshAttributedMutationContext = Readonly<{
  operatorActorId: string;
  correlationId: string;
}>;
export type DshVersionedMutationContext = DshAttributedMutationContext & Readonly<{
  expectedVersion: number;
}>;
export type JoiningCaseMutationContext = DshAttributedMutationContext & Readonly<{
  idempotencyKey: string;
}>;
export type StorePublicationMutationContext = DshVersionedMutationContext & Readonly<{
  idempotencyKey: string;
}>;
export type DshOperatorReadContext = Readonly<{
  operatorActorId: string;
}>;
export function dshBaseUrl(): string {
  const explicit = process.env.DSH_API_BASE_URL?.trim();
  if (explicit) {
    try {
      return validateServiceUrl(explicit, "DSH_API_BASE_URL");
    } catch {
      throw { kind: "config", message: "dsh service must use HTTPS" } satisfies DshClientError;
    }
  }
  throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
}

export function dshToken(): string {
  const token = process.env.CONTROL_PANEL_SERVICE_TOKEN?.trim();
  if (!token || token.length < 24) throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
  return token;
}

export function validateAttributedMutationContext(context: DshAttributedMutationContext): void {
  if (!context.operatorActorId.trim() || !context.correlationId.trim()) {
    throw { kind: "config", message: "dsh mutation context is incomplete" } satisfies DshClientError;
  }
}

export function validateVersionedMutationContext(context: DshVersionedMutationContext): void {
  validateAttributedMutationContext(context);
  if (!Number.isInteger(context.expectedVersion) || context.expectedVersion < 1) {
    throw { kind: "config", message: "dsh expected version is invalid" } satisfies DshClientError;
  }
}

export function parseErrorPayload(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== "object") return { code: "DSH_ERROR", message: "تعذر قراءة رد خدمة البيانات التشغيلية." };
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return { code: "DSH_ERROR", message: "تعذر قراءة رد خدمة البيانات التشغيلية." };
  const code = (nested as { code?: unknown }).code;
  const message = (nested as { message?: unknown }).message;
  return {
    code: typeof code === "string" && code.trim() ? code : "DSH_ERROR",
    message: typeof message === "string" && message.trim() ? message : "تعذر قراءة رد خدمة البيانات التشغيلية.",
  };
}

export function isDshClientError(value: unknown): value is DshClientError {
  return Boolean(value && typeof value === "object" && (["http", "network", "config"] as const).includes((value as { kind?: unknown }).kind as "http" | "network" | "config"));
}

export function dshErrorPayload(error: unknown): Readonly<{ code: string; message: string }> {
  if (!isDshClientError(error)) return { code: "DSH_INTERNAL_ERROR", message: "تعذر إكمال الطلب في خدمة البيانات التشغيلية." };
  if (error.kind === "network") return { code: "DSH_UNAVAILABLE", message: "تعذر الاتصال بخدمة البيانات التشغيلية." };
  if (error.kind === "config") return { code: "DSH_CONFIG_ERROR", message: "خدمة البيانات التشغيلية غير مهيأة بالكامل." };
  return { code: error.code, message: error.message };
}

export function dshHttpStatus(error: unknown): number {
  if (!isDshClientError(error)) return 502;
  return error.kind === "network" ? 502 : error.kind === "config" ? 500 : error.status;
}

export async function requestDshJson<T>(method: string, path: string, body: unknown | undefined, headers: Record<string, string>, actorAccessToken?: string): Promise<Readonly<{ status: number; payload: T }>> {
  const baseUrl = dshBaseUrl();
  const token = actorAccessToken ?? dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: response.status === 204 ? undefined as T : await response.json() as T };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestDshMultipart<T>(method: string, path: string, body: FormData, headers: Record<string, string>): Promise<Readonly<{ status: number; payload: T }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...headers }, body, signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: await response.json() as T };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestDshFile(path: string, headers: Record<string, string>): Promise<Readonly<{ content: Uint8Array; contentType: string; contentDisposition: string }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method: "GET", headers: { Accept: "application/octet-stream", Authorization: `Bearer ${token}`, ...headers }, cache: "no-store", signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength > 10 * 1024 * 1024) throw { kind: "http", status: 502, code: "INVALID_EVIDENCE_RESPONSE", message: "evidence response exceeds the supported size" } satisfies DshClientError;
    return { content, contentType: response.headers.get("content-type") ?? "application/octet-stream", contentDisposition: response.headers.get("content-disposition") ?? "" };
  } finally {
    clearTimeout(timeout);
  }
}

export function appendMediaProvenance(body: FormData, provenance: MediaProvenanceInput): void {
  body.set("creator", provenance.creator.trim());
  body.set("sourceDescription", provenance.sourceDescription.trim());
  body.set("sourceUri", provenance.sourceUri?.trim() ?? "");
  body.set("rightsStatement", provenance.rightsStatement.trim());
  body.set("rightsUri", provenance.rightsUri?.trim() ?? "");
  body.set("rightsAttested", String(provenance.rightsAttested));
}
