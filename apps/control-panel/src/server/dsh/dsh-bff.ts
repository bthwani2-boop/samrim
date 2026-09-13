import { validateServiceUrl, type ManagedActivationRole } from "@bthwani/identity";
import { type ActorRoleView, type CreateJoiningCaseRequest, type JoiningCaseResponse, type ManagedRole, type ManagedRoleStatusResponse, type PublicationAction, type ReviewJoiningCaseRequest, type StorePublicationRequest, type StorePublicationResponse, dshOperationPaths } from "@bthwani/dsh";

type DshClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>
  | Readonly<{ kind: "config"; message: string }>;

export type ManagedRoleStatus = ManagedRoleStatusResponse;
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
  throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
}

function dshToken(): string {
  const token = process.env.CONTROL_PANEL_SERVICE_TOKEN?.trim();
  if (!token || token.length < 24) throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
  return token;
}

function validateAttributedMutationContext(context: DshAttributedMutationContext): void {
  if (!context.operatorActorId.trim() || !context.correlationId.trim()) {
    throw { kind: "config", message: "dsh mutation context is incomplete" } satisfies DshClientError;
  }
}

function validateVersionedMutationContext(context: DshVersionedMutationContext): void {
  validateAttributedMutationContext(context);
  if (!Number.isInteger(context.expectedVersion) || context.expectedVersion < 1) {
    throw { kind: "config", message: "dsh expected version is invalid" } satisfies DshClientError;
  }
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

async function requestDshJson<T>(method: string, path: string, body: unknown | undefined, headers: Record<string, string>): Promise<Readonly<{ status: number; payload: T }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
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
    return { status: response.status, payload: await response.json() as T };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createJoiningCase(
  input: CreateJoiningCaseRequest,
  context: JoiningCaseMutationContext,
): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!input.contactPhoneE164.trim() || !input.businessName.trim() || !input.firstStoreName.trim()) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.createJoiningCase.method, dshOperationPaths.createJoiningCase.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readJoiningCase(caseId: string, context: DshOperatorReadContext): Promise<JoiningCaseResponse> {
  if (!caseId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_JOINING_CASE_READ_INPUT_INVALID");
  const path = dshOperationPaths.readJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return (await requestDshJson<JoiningCaseResponse>(dshOperationPaths.readJoiningCase.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function submitJoiningCase(caseId: string, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!caseId.trim()) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.submitJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.submitJoiningCase.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reviewJoiningCase(caseId: string, input: ReviewJoiningCaseRequest, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!caseId.trim() || !input.decision) throw new Error("DSH_JOINING_CASE_REVIEW_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.reviewJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.reviewJoiningCase.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readStorePublication(
  storeId: string,
  context: DshOperatorReadContext,
): Promise<StorePublicationResponse> {
  if (!storeId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PUBLICATION_READ_INPUT_INVALID");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const path = dshOperationPaths.readStorePublication.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
      response = await fetch(`${baseUrl}${path}`, {
        method: dshOperationPaths.readStorePublication.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Acting-Actor-ID": context.operatorActorId.trim(),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return await response.json() as StorePublicationResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function setStorePublication(
  storeId: string,
  state: PublicationAction,
  context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: StorePublicationResponse }>> {
  if (!storeId.trim() || !["published", "hidden"].includes(state)) throw new Error("DSH_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PUBLICATION_IDEMPOTENCY_INVALID");
  const input: StorePublicationRequest = { state };
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const path = dshOperationPaths.setStorePublication.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
      response = await fetch(`${baseUrl}${path}`, {
        method: dshOperationPaths.setStorePublication.method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Acting-Actor-ID": context.operatorActorId.trim(),
          "X-Correlation-ID": context.correlationId.trim(),
          "X-Expected-Version": String(context.expectedVersion),
          "Idempotency-Key": context.idempotencyKey.trim(),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: await response.json() as StorePublicationResponse };
  } finally {
    clearTimeout(timeout);
  }
}

export async function provisionManagedRole(
  phone: string,
  role: ManagedActivationRole,
  context: DshAttributedMutationContext,
): Promise<ActorRoleView> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  validateAttributedMutationContext(context);
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
      headers["X-Acting-Actor-ID"] = context.operatorActorId.trim();
      headers["X-Correlation-ID"] = context.correlationId.trim();
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
  context: DshAttributedMutationContext,
): Promise<void> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  validateAttributedMutationContext(context);
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
        "X-Correlation-ID": context.correlationId.trim(),
      };
      headers["X-Acting-Actor-ID"] = context.operatorActorId.trim();
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
  context: DshVersionedMutationContext,
): Promise<void> {
  if (!managedRoles.has(role)) throw new Error("DSH_ROLE_NOT_SUPPORTED");
  validateVersionedMutationContext(context);
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
        "X-Correlation-ID": context.correlationId.trim(),
      };
      headers["X-Acting-Actor-ID"] = context.operatorActorId.trim();
      headers["X-Expected-Version"] = String(context.expectedVersion);
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
