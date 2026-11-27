/** DSH-owned Store registration; Identity grants an actor role, not a Store. */
import { consumeOwnerResponse, DshPublicError, endpoint, readBoundedOwnerJSON } from "./client-core.ts";
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

// 100 choices * 4000 Unicode scalars * six JSON escape bytes, plus
// bounded IDs, metadata, verticals and the browser's outer envelope.
export const merchantRegistrationOptionsByteLimit = 2_500_000;
const receiptLimit = 65536;
const requestKeys = ["operationId", "name", "cityId", "verticalId", "relation", "latitude",
  "longitude", "policyVersion", "termsVersion", "acceptedTerms"];
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function publicId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/u.test(value);
}
function termsVersion(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9._-]{3,80}$/u.test(value);
}
function relation(value: unknown): boolean {
  return value === "MARKETPLACE" || value === "DIRECT";
}
function positiveVersion(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
function ownerTrim(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
function validName(value: unknown): value is string {
  return typeof value === "string" && !/[\p{Cc}\p{Cs}]/u.test(value)
    && ownerTrim(value).length > 0 && [...ownerTrim(value)].length <= 120;
}
function validTerms(value: unknown): boolean {
  return typeof value === "string" && !/\p{Cs}/u.test(value) && !value.includes("\u0000")
    && ownerTrim(value).length > 0 && [...value].length <= 4000;
}
function coordinate(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

export function parseMerchantRegistrationOptions(body: unknown): MerchantRegistrationOptions {
  const value = record(body);
  if (!value || !exact(value, ["choices", "verticals"]) ||
    !Array.isArray(value.choices) || value.choices.length > 100 ||
    !Array.isArray(value.verticals) || value.verticals.length > 100 ||
    (value.choices.length > 0 && value.verticals.length === 0)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const used = new Set<string>();
  for (const entry of value.choices) {
    const c = record(entry);
    if (!c || !exact(c, ["cityId", "relation", "policyVersion", "termsVersion", "termsText"]) ||
      !publicId(c.cityId) || !relation(c.relation) || !positiveVersion(c.policyVersion) ||
      !termsVersion(c.termsVersion) || !validTerms(c.termsText)) {
      throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    }
    const scope = c.cityId + ":" + c.relation;
    if (used.has(scope)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
    used.add(scope);
  }
  if (!value.verticals.every(publicId) || new Set(value.verticals).size !== value.verticals.length) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return value as MerchantRegistrationOptions;
}

export function parseMerchantRegistrationResult(body: unknown): MerchantRegistrationResult {
  const value = record(body);
  const store = record(value?.store);
  if (!value || !exact(value, ["store", "replay"]) || typeof value.replay !== "boolean" ||
    !store || !exact(store, ["id", "name", "relation", "published"]) ||
    !publicId(store.id) || !validName(store.name) || [...store.name].length > 120 ||
    !relation(store.relation) || typeof store.published !== "boolean") {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return value as MerchantRegistrationResult;
}

export function validMerchantStoreRegistration(input: unknown): input is MerchantStoreRegistration {
  const v = record(input);
  return !!v && exact(v, requestKeys)
    && typeof v.operationId === "string" && /^[A-Za-z0-9._-]{8,128}$/u.test(v.operationId)
    && validName(v.name) && publicId(v.cityId) && publicId(v.verticalId)
    && relation(v.relation) && coordinate(v.latitude, 90) && coordinate(v.longitude, 180)
    && positiveVersion(v.policyVersion) && termsVersion(v.termsVersion) && v.acceptedTerms === true;
}

/** Fresh creation is unpublished; replay returns the current owned Store. */
export function confirmMerchantRegistrationResult(
  body: unknown, status: number, input: MerchantStoreRegistration,
): MerchantRegistrationResult {
  const result = parseMerchantRegistrationResult(body);
  if (!validMerchantStoreRegistration(input) || status !== (result.replay ? 200 : 201)
    || result.store.relation !== input.relation
    || (!result.replay && (result.store.published || result.store.name !== ownerTrim(input.name)))) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result;
}

export function isMerchantRegistrationRejection(status: number, code: unknown): boolean {
  return (status === 400 && code === "INVALID_STORE_REGISTRATION")
    || (status === 401 && code === "UNAUTHENTICATED")
    || (status === 403 && (code === "STORE_REGISTRATION_CLOSED" || code === "STORE_OPERATION_FORBIDDEN"))
    || (status === 409 && (code === "STORE_REGISTRATION_POLICY_CHANGED" || code === "IDEMPOTENCY_KEY_REUSED"));
}

function isPrivateJSON(response: Response): boolean {
  const cache = response.headers.get("Cache-Control")?.toLowerCase().split(",").map(x => x.trim()) ?? [];
  return cache.includes("no-store")
    && response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

async function ownerCall(
  origin: string, bearer: string, method: "GET" | "POST", path: string,
  signal?: AbortSignal, input?: MerchantStoreRegistration,
): Promise<{ body: unknown; status: number }> {
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  const writing = method === "POST";
  const current = () => {
    if (signal?.aborted) throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  };
  const invalid = () => new DshPublicError(502, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  const url = endpoint(origin, path);
  current();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, redirect: "error", credentials: "omit", cache: "no-store", signal: signal ?? null,
      headers: { Accept: "application/json", Authorization: "Bearer " + bearer,
        ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify({ ...input, name: ownerTrim(input.name) }) } : {}),
    });
  } catch {
    current();
    throw new DshPublicError(0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_UNAVAILABLE");
  }
  return consumeOwnerResponse(response, async () => {
    current();
    if (!response.ok) {
      let code: string | undefined;
      if (isPrivateJSON(response)) {
        try {
          const error = record(await readBoundedOwnerJSON(response, 2048, 2048, signal));
          if (error && exact(error, ["code"]) && typeof error.code === "string") code = error.code;
        } catch { /* A malformed failure is not a definitive owner rejection. */ }
      }
      current();
      if (code && isMerchantRegistrationRejection(response.status, code)) {
        throw new DshPublicError(response.status, code);
      }
      throw new DshPublicError(response.status, writing ? "OPERATION_RESULT_UNKNOWN" :
        (response.status === 503 && (code === "IDENTITY_OWNER_UNAVAILABLE" || code === "STORE_OWNER_UNAVAILABLE"))
          ? code : "OWNER_UNAVAILABLE");
    }
    if (!isPrivateJSON(response) || (writing ? ![200, 201].includes(response.status) : response.status !== 200)) {
      throw invalid();
    }
    const limit = writing ? receiptLimit : merchantRegistrationOptionsByteLimit;
    let body: unknown;
    try {
      body = await readBoundedOwnerJSON(response, limit, limit, signal);
    } catch {
      current();
      throw invalid();
    }
    current();
    return { body, status: response.status };
  });
}

export async function readMerchantRegistrationOptions(origin: string, bearer: string, signal?: AbortSignal) {
  const reply = await ownerCall(origin, bearer, "GET", dshOperations.getMerchantStoreRegistrationOptions.path, signal);
  return parseMerchantRegistrationOptions(reply.body);
}

export async function registerMerchantStore(
  origin: string, bearer: string, input: MerchantStoreRegistration, signal?: AbortSignal,
): Promise<MerchantRegistrationResult> {
  if (!validMerchantStoreRegistration(input)) throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  const reply = await ownerCall(origin, bearer, "POST", dshOperations.registerMerchantStore.path, signal, input);
  return confirmMerchantRegistrationResult(reply.body, reply.status, input);
}
