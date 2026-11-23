/** DSH-owned Store registration; Identity grants an actor role, not a Store. */
import { DshPublicError, endpoint, readBoundedOwnerJSON } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";

export type MerchantRegistrationChoice = {
  cityId: string;
  relation: "MARKETPLACE" | "DIRECT";
  policyVersion: number;
  termsVersion: string;
  termsText: string;
};
export type MerchantRegistrationOptions = { choices: MerchantRegistrationChoice[]; verticals: string[] };
export type MerchantStoreRegistration = {
  operationId: string;
  name: string;
  cityId: string;
  verticalId: string;
  relation: MerchantRegistrationChoice["relation"];
  latitude: number;
  longitude: number;
  policyVersion: number;
  termsVersion: string;
  acceptedTerms: true;
};
export type MerchantRegistrationResult = {
  store: { id: string; name: string; relation: MerchantRegistrationChoice["relation"]; published: boolean };
  replay: boolean;
};

const key = /^[a-z0-9-]{1,64}$/;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const operationIdRule = /^[A-Za-z0-9._-]{8,128}$/;
const termsRule = /^[a-z0-9._-]{3,80}$/;
function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function hasKeys(v: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(v).length === keys.length && Object.keys(v).every(x => keys.includes(x));
}
export function parseMerchantRegistrationOptions(body: unknown): MerchantRegistrationOptions {
  const value = record(body);
  if (!value || !hasKeys(value, ["choices", "verticals"]) ||
    !Array.isArray(value.choices) || value.choices.length > 100 ||
    !Array.isArray(value.verticals) || value.verticals.length > 100) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const used = new Set<string>();
  for (const entry of value.choices) {
    const c = record(entry);
    if (!c || !hasKeys(c, ["cityId", "relation", "policyVersion", "termsVersion", "termsText"]) ||
      typeof c.cityId !== "string" || !key.test(c.cityId) ||
      (c.relation !== "MARKETPLACE" && c.relation !== "DIRECT") ||
      !Number.isSafeInteger(c.policyVersion) || (c.policyVersion as number) < 1 ||
      typeof c.termsVersion !== "string" || !termsRule.test(c.termsVersion) ||
      typeof c.termsText !== "string" || !c.termsText.trim() || c.termsText.length > 4000 ||
      used.has(`${c.cityId}:${c.relation}`)) {
      throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    }
    used.add(`${c.cityId}:${c.relation}`);
  }
  if (value.verticals.some(x => typeof x !== "string" || !key.test(x)) ||
    new Set(value.verticals).size !== value.verticals.length) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return value as MerchantRegistrationOptions;
}
export function parseMerchantRegistrationResult(body: unknown): MerchantRegistrationResult {
  const value = record(body);
  const store = record(value?.store);
  if (!value || !hasKeys(value, ["store", "replay"]) || typeof value.replay !== "boolean" ||
    !store || !hasKeys(store, ["id", "name", "relation", "published"]) ||
    typeof store.id !== "string" || !key.test(store.id) ||
    typeof store.name !== "string" || !store.name.trim() || [...store.name].length > 120 ||
    (store.relation !== "MARKETPLACE" && store.relation !== "DIRECT") ||
    typeof store.published !== "boolean") {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return value as MerchantRegistrationResult;
}
export function validMerchantStoreRegistration(input: MerchantStoreRegistration): boolean {
  return !!input && operationIdRule.test(input.operationId) &&
    !!input.name.trim() && [...input.name.trim()].length <= 120 &&
    key.test(input.cityId) && key.test(input.verticalId) &&
    (input.relation === "MARKETPLACE" || input.relation === "DIRECT") &&
    Number.isFinite(input.latitude) && input.latitude >= -90 && input.latitude <= 90 &&
    Number.isFinite(input.longitude) && input.longitude >= -180 && input.longitude <= 180 &&
    Number.isSafeInteger(input.policyVersion) && input.policyVersion >= 1 &&
    termsRule.test(input.termsVersion) && input.acceptedTerms === true;
}
function assertBearer(bearer: string) {
  if (!bearerRule.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
}
async function ownerCall(
  origin: string, bearer: string, method: "GET" | "POST", path: string,
  signal?: AbortSignal, input?: MerchantStoreRegistration,
): Promise<{ body: unknown; status: number }> {
  assertBearer(bearer);
  const url = endpoint(origin, path);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, redirect: "error", credentials: "omit", cache: "no-store",
      signal: signal ?? null,
      headers: { Accept: "application/json", Authorization: `Bearer ${bearer}`,
        ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  } catch {
    throw new DshPublicError(0, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE");
  }
  if (signal?.aborted) throw new DshPublicError(0,
    method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  if (!response.ok) {
    let code = "OWNER_UNAVAILABLE";
    try {
      const error = record(await readBoundedOwnerJSON(response, 2048, 2048));
      if (typeof error?.code === "string" &&
        ["INVALID_STORE_REGISTRATION", "STORE_REGISTRATION_CLOSED",
          "STORE_REGISTRATION_POLICY_CHANGED", "IDEMPOTENCY_KEY_REUSED",
          "UNAUTHENTICATED", "STORE_OPERATION_FORBIDDEN",
          "IDENTITY_OWNER_UNAVAILABLE", "STORE_OWNER_UNAVAILABLE",
          "OPERATION_RESULT_UNKNOWN"].includes(error.code)) code = error.code;
    } catch { /* Untrusted owner failure stays generic. */ }
    if (method === "POST" && response.status >= 500) code = "OPERATION_RESULT_UNKNOWN";
    throw new DshPublicError(response.status, code);
  }
  const cache = response.headers.get("Cache-Control")?.toLowerCase().split(",").map(x => x.trim()) ?? [];
  if (!cache.includes("no-store") ||
    response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    (method === "GET" ? response.status !== 200 : ![200, 201].includes(response.status))) {
    throw new DshPublicError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  try {
    const body = await readBoundedOwnerJSON(response, 65536, 65536);
    if (signal?.aborted) throw new Error("Aborted after read");
    return { body, status: response.status };
  } catch {
    throw new DshPublicError(502, method === "POST" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
}
export async function readMerchantRegistrationOptions(origin: string, bearer: string, signal?: AbortSignal) {
  const reply = await ownerCall(origin, bearer, "GET",
    dshOperations.getMerchantStoreRegistrationOptions.path, signal);
  return parseMerchantRegistrationOptions(reply.body);
}
export async function registerMerchantStore(
  origin: string, bearer: string, input: MerchantStoreRegistration, signal?: AbortSignal,
): Promise<MerchantRegistrationResult> {
  if (!validMerchantStoreRegistration(input)) throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  const reply = await ownerCall(origin, bearer, "POST", dshOperations.registerMerchantStore.path, signal, input);
  const result = parseMerchantRegistrationResult(reply.body);
  if (result.replay !== (reply.status === 200) ||
    result.store.relation !== input.relation ||
    (!result.replay && (result.store.published || result.store.name !== input.name.trim()))) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result;
}
