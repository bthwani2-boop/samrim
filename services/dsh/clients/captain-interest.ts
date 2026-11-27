import { DshPublicError, endpoint, isDateTime, onlyKeys, readBoundedOwnerJSON } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export const captainVehicleTypes = ["MOTORCYCLE", "ELECTRIC", "BICYCLE", "NONE"] as const;
export const captainPhoneTypes = ["SMART", "BASIC", "NONE"] as const;
export type CaptainVehicleType = typeof captainVehicleTypes[number];
export type CaptainPhoneType = typeof captainPhoneTypes[number];
export interface CaptainInterestInput {
  name: string;
  phone: string;
  city: string;
  district: string;
  vehicleType: CaptainVehicleType;
  plateRegistered?: boolean;
  phoneType: CaptainPhoneType;
  experienced: boolean;
  experienceDetails?: string;
}
export interface OperatorCaptainInterest extends CaptainInterestInput {
  id: number;
  contacted: boolean;
  createdAt: string;
}
export interface OperatorCaptainInterestPage {
  items: OperatorCaptainInterest[];
  nextCursor?: string;
}
export interface OperatorCaptainInterestFilter {
  city?: string;
  vehicle?: CaptainVehicleType;
  contacted?: boolean;
  before?: number;
  limit?: number;
}

const optional = ["plateRegistered", "experienceDetails"];
const submitted = ["name", "phone", "city", "district", "vehicleType", "phoneType", "experienced"];
const record = [...submitted, ...optional, "id", "contacted", "createdAt"];
const validText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim() === value &&
  Array.from(value).length >= min && Array.from(value).length <= max &&
  !Array.from(value).some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) || code === 0x200b || code === 0xfeff;
  });
const validPhone = (value: unknown): value is string =>
  typeof value === "string" && /^(?:(?:\+967|967))?7[0-9]{8}$/.test(value);
const vehicle = (value: unknown): value is CaptainVehicleType =>
  captainVehicleTypes.includes(value as CaptainVehicleType);
const phoneType = (value: unknown): value is CaptainPhoneType =>
  captainPhoneTypes.includes(value as CaptainPhoneType);

export function validCaptainInterest(input: unknown): input is CaptainInterestInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const v = input as Record<string, unknown>;
  return onlyKeys(v, [...submitted, ...optional]) &&
    submitted.every(key => Object.hasOwn(v, key)) &&
    validText(v.name, 4, 100) && validPhone(v.phone) &&
    validText(v.city, 2, 80) && validText(v.district, 2, 100) &&
    vehicle(v.vehicleType) &&
    ((v.vehicleType === "MOTORCYCLE" || v.vehicleType === "ELECTRIC")
      ? typeof v.plateRegistered === "boolean" : v.plateRegistered === undefined) &&
    phoneType(v.phoneType) && typeof v.experienced === "boolean" &&
    (v.experienceDetails === undefined ||
      (v.experienced === true && validText(v.experienceDetails, 1, 200)));
}
export function isOperatorCaptainInterest(input: unknown): input is OperatorCaptainInterest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return onlyKeys(value, record) &&
    Number.isSafeInteger(value.id) && Number(value.id) > 0 &&
    typeof value.contacted === "boolean" &&
    isDateTime(value.createdAt) && validCaptainInterest(
      Object.fromEntries(Object.entries(value).filter(([key]) => [...submitted, ...optional].includes(key)))
    );
}
export async function submitCaptainInterest(
  baseUrl: string, input: CaptainInterestInput, signal?: AbortSignal,
): Promise<void> {
  if (!validCaptainInterest(input)) throw new DshPublicError(400, "INVALID_REQUEST");
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  const url = endpoint(baseUrl, dshOperations.submitPublicCaptainInterest.path);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST", signal: signal ?? null, redirect: "error",
      credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch { throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN"); }
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!response.ok || response.status !== 202) {
    if (response.status === 400) throw new DshPublicError(400, "INVALID_REQUEST");
    if (response.status === 429) throw new DshPublicError(429, "RATE_LIMITED");
    throw new DshPublicError(response.status, "OPERATION_RESULT_UNKNOWN");
  }
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      !response.headers.get("Cache-Control")?.toLowerCase().split(",").some(x => x.trim() === "no-store")) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  let body: unknown;
  try { body = await readBoundedOwnerJSON(response, 128, 256, signal); }
  catch { throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN"); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    !onlyKeys(body as Record<string, unknown>, ["received"]) ||
    Object.keys(body).length !== 1 || (body as { received?: unknown }).received !== true ||
    signal?.aborted) throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
}
export async function listOperatorCaptainInterest(
  baseUrl: string, bearer: string, options: OperatorCaptainInterestFilter & { signal?: AbortSignal } = {},
): Promise<OperatorCaptainInterestPage> {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    options.before !== undefined && (!Number.isSafeInteger(options.before) || options.before < 1) ||
    options.city !== undefined && !validText(options.city, 2, 80) ||
    options.vehicle !== undefined && !vehicle(options.vehicle)) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.before !== undefined) query.set("before", String(options.before));
  if (options.city !== undefined) query.set("city", options.city);
  if (options.vehicle !== undefined) query.set("vehicle", options.vehicle);
  if (options.contacted !== undefined) query.set("contacted", String(options.contacted));
  const value = await privateOwnerRequest(baseUrl,
    `${dshOperations.listOperatorCaptainInterest.path}?${query.toString()}`,
    bearer, "GET", undefined, options.signal);
  const page = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (!page || !onlyKeys(page, ["items", "nextCursor"]) ||
    !Array.isArray(page.items) || page.items.length > limit ||
    !page.items.every(isOperatorCaptainInterest) ||
    new Set(page.items.map(item => item.id)).size !== page.items.length ||
    page.nextCursor !== undefined &&
      (typeof page.nextCursor !== "string" || !/^[1-9][0-9]*$/.test(page.nextCursor))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return value as OperatorCaptainInterestPage;
}
export async function markOperatorCaptainInterestContacted(
  baseUrl: string, bearer: string, id: number, signal?: AbortSignal,
): Promise<OperatorCaptainInterest> {
  if (!Number.isSafeInteger(id) || id < 1) throw new DshPublicError(400, "INVALID_REQUEST");
  const value = await privateOwnerRequest(baseUrl,
    dshOperations.markOperatorCaptainInterestContacted.path.replace("{id}", String(id)),
    bearer, "PATCH", { contacted: true }, signal);
  if (!isOperatorCaptainInterest(value) || value.id !== id || !value.contacted)
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  return value;
}
