import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

// All city policies share one command admission and response handoff.
// The submitted snapshot is detached from caller-owned arrays and objects.
// Owner-normalized text follows Go strings.TrimSpace, not JavaScript trim.
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function cityValid(city: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(city);
}
function operationValid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(value);
}
function ownerTrim(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
function reasonValid(value: unknown, controlsForbidden = false): value is string {
  if (typeof value !== "string" || /\p{Cs}/u.test(value) || [...value].length > 300) return false;
  const normalized = ownerTrim(value);
  return normalized.length > 0 && (!controlsForbidden || !/\p{Cc}/u.test(normalized));
}
function actorValid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && ownerTrim(value) === value &&
    !/[\p{Cc}\p{Cs}]/u.test(value) && new TextEncoder().encode(value).length <= 128;
}
function invalid(): never { throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE"); }
function invalidOwner(): never { throw new DshPublicError(502, "OWNER_RESPONSE_INVALID"); }
function unknownResult(): never { throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN"); }
type CityOperation = keyof typeof dshOperations;
function cityPath(operation: CityOperation, city: string, relation?: CityFulfillmentRelation): string {
  const path = dshOperations[operation].path.replace("{cityID}", encodeURIComponent(city));
  return relation === undefined ? path : path.replace("{relation}", relation);
}
function envelope(value: unknown): value is { policy: unknown; replay: boolean } {
  return record(value) && fields(value, ["policy", "replay"]) && typeof value.replay === "boolean";
}
// A response can become stale between the transport's promise and the
// operation's final handoff. All reads, including non-payable previews, must
// independently refuse stale evidence; a write must retain unknown outcome.
function admitRead<T>(value: unknown, valid: (value: unknown) => value is T, signal?: AbortSignal): T {
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (!valid(value)) invalidOwner();
  return value;
}
function admitWrite<T>(value: unknown, valid: (value: unknown) => value is T, signal?: AbortSignal): T {
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  if (!valid(value)) unknownResult();
  return value;
}
export interface CityStoreOperationalPolicy {
  cityId: string;
  version: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  changedByActor: string;
  changeReason: string;
  updatedAt: string;
}
export interface CityStoreOperationalPolicyChange {
  operationId: string;
  expectedVersion: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  reason: string;
}
export interface CityStoreOperationalPolicyResult {
  policy: CityStoreOperationalPolicy;
  replay: boolean;
}
export interface CityStoreOperationalPolicyHistoryPage {
  cityId: string;
  entries: CityStoreOperationalPolicy[];
  nextBeforeVersion?: string;
}

function isStorePolicy(value: unknown, city: string): value is CityStoreOperationalPolicy {
  return record(value) && fields(value, ["cityId", "version", "maxPauseSeconds", "maxPreparationMinutes",
    "changedByActor", "changeReason", "updatedAt"]) && value.cityId === city && integer(value.version, 1) &&
    integer(value.maxPauseSeconds, 0, 31536000) && integer(value.maxPreparationMinutes, 0, 1440) &&
    actorValid(value.changedByActor) && reasonValid(value.changeReason) && ownerTrim(value.changeReason) === value.changeReason && isDateTime(value.updatedAt);
}
function storeSubmission(value: unknown): CityStoreOperationalPolicyChange | null {
  if (!record(value) || !fields(value, ["operationId", "expectedVersion", "maxPauseSeconds", "maxPreparationMinutes", "reason"])) return null;
  const { operationId, expectedVersion, maxPauseSeconds, maxPreparationMinutes, reason } = value;
  if (!operationValid(operationId) || !integer(expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1) ||
    !integer(maxPauseSeconds, 0, 31536000) || !integer(maxPreparationMinutes, 0, 1440) || !reasonValid(reason)) return null;
  return { operationId, expectedVersion, maxPauseSeconds, maxPreparationMinutes, reason };
}
export async function getCityStoreOperationalPolicy(
  baseUrl: string, cityID: string, bearer: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicy> {
  if (!cityValid(cityID)) throw new DshPublicError(0, "CITY_ID_INVALID");
  const value = await privateOwnerRequest(baseUrl, cityPath("getCityStoreOperationalPolicy", cityID), bearer, "GET", undefined, signal);
  return admitRead(value, (body): body is CityStoreOperationalPolicy => isStorePolicy(body, cityID), signal);
}
/** The same operationId must be retained for reconciliation after an unknown result. */
export async function replaceCityStoreOperationalPolicy(
  baseUrl: string, cityID: string, bearer: string, change: CityStoreOperationalPolicyChange, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyResult> {
  if (!cityValid(cityID)) throw new DshPublicError(0, "CITY_ID_INVALID");
  const submitted = storeSubmission(change);
  if (!submitted) invalid();
  const value = await privateOwnerRequest(baseUrl, cityPath("replaceCityStoreOperationalPolicy", cityID), bearer, "PATCH", submitted, signal);
  return admitWrite(value, (body): body is CityStoreOperationalPolicyResult =>
    envelope(body) && isStorePolicy(body.policy, cityID) &&
    body.policy.version === submitted.expectedVersion + 1 &&
    body.policy.maxPauseSeconds === submitted.maxPauseSeconds &&
    body.policy.maxPreparationMinutes === submitted.maxPreparationMinutes &&
    body.policy.changeReason === ownerTrim(submitted.reason), signal);
}
function validHistoryVersion(value: string): boolean {
  return /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}
export function isCityStoreOperationalPolicyHistoryPage(
  value: unknown, cityId: string, limit: number, beforeVersion?: string,
): value is CityStoreOperationalPolicyHistoryPage {
  if (!record(value) || !integer(limit, 1, 50) ||
    (beforeVersion !== undefined && !validHistoryVersion(beforeVersion)) ||
    !onlyKeys(value, ["cityId", "entries", "nextBeforeVersion"]) || value.cityId !== cityId ||
    !Array.isArray(value.entries) || value.entries.length > limit) return false;
  let previous = beforeVersion === undefined ? Number.POSITIVE_INFINITY : Number(beforeVersion);
  for (const entry of value.entries) {
    if (!isStorePolicy(entry, cityId) || entry.version >= previous) return false;
    previous = entry.version;
  }
  return value.nextBeforeVersion === undefined || (value.entries.length === limit &&
    typeof value.nextBeforeVersion === "string" && validHistoryVersion(value.nextBeforeVersion) &&
    value.nextBeforeVersion === String(previous));
}
export async function listCityStoreOperationalPolicyHistory(
  baseUrl: string, cityId: string, bearer: string, limit = 20, beforeVersion?: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyHistoryPage> {
  if (!cityValid(cityId) || !integer(limit, 1, 50) || (beforeVersion !== undefined && !validHistoryVersion(beforeVersion))) invalid();
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeVersion) params.set("beforeVersion", beforeVersion);
  const value = await privateOwnerRequest(baseUrl, cityPath("listCityStoreOperationalPolicyHistory", cityId) + "?" + params.toString(), bearer, "GET", undefined, signal);
  return admitRead(value, (body): body is CityStoreOperationalPolicyHistoryPage =>
    isCityStoreOperationalPolicyHistoryPage(body, cityId, limit, beforeVersion), signal);
}

export interface CityDeliveryDistanceBand {
  upToMeters: number | null;
  ratePerKmMinor: number;
}
export interface CityDeliveryPolicy {
  cityId: string;
  version: number;
  radiusMetres: number;
  updatedAt: string;
  distanceBands?: CityDeliveryDistanceBand[];
}
export type CityDeliveryPolicyState = CityDeliveryPolicy | { cityId: string; version: 0; radiusMetres?: never; updatedAt?: never; distanceBands?: never };
export interface CityDeliveryPolicyPreviewInput {
  expectedVersion: number;
  radiusMetres: number;
  distanceMetres: number;
  distanceBands: CityDeliveryDistanceBand[];
}
export interface CityDeliveryPolicyPreview {
  cityId: string;
  version: number;
  radiusMetres: number;
  distanceMetres: number;
  feeYer: string;
  payable: false;
}
export interface CityDeliveryPolicyChange {
  operationId: string;
  expectedVersion: number;
  radiusMetres: number;
  distanceBands: CityDeliveryDistanceBand[];
  reason: string;
}
export interface CityDeliveryPolicyResult {
  policy: CityDeliveryPolicy;
  replay: boolean;
}

function captureBands(value: unknown): CityDeliveryDistanceBand[] | null {
  if (!Array.isArray(value) || !integer(value.length, 1, 30)) return null;
  const size = value.length;
  const result: CityDeliveryDistanceBand[] = [];
  let previous = 0;
  for (let index = 0; index < size; index++) {
    const band: unknown = value[index];
    if (!record(band) || !fields(band, ["upToMeters", "ratePerKmMinor"])) return null;
    const { upToMeters, ratePerKmMinor } = band;
    if (!integer(ratePerKmMinor, 1, 100000000)) return null;
    if (index === size - 1) {
      if (upToMeters !== null) return null;
      result.push({ upToMeters, ratePerKmMinor });
    } else {
      if (!integer(upToMeters, previous + 1, 500000)) return null;
      result.push({ upToMeters, ratePerKmMinor });
      previous = upToMeters;
    }
  }
  return result;
}
export function isCityDeliveryDistanceBands(value: unknown): value is CityDeliveryDistanceBand[] {
  return captureBands(value) !== null;
}
function previewSubmission(value: unknown): CityDeliveryPolicyPreviewInput | null {
  if (!record(value) || !fields(value, ["expectedVersion", "radiusMetres", "distanceMetres", "distanceBands"])) return null;
  const { expectedVersion, radiusMetres, distanceMetres } = value;
  const distanceBands = captureBands(value.distanceBands);
  if (!integer(expectedVersion, 0) || !integer(radiusMetres, 1, 2147483647) ||
    !integer(distanceMetres, 0, radiusMetres) || !distanceBands) return null;
  return { expectedVersion, radiusMetres, distanceMetres, distanceBands };
}
export function isCityDeliveryPolicyPreviewInput(value: unknown): value is CityDeliveryPolicyPreviewInput {
  return previewSubmission(value) !== null;
}
export function isCityDeliveryPolicyPreview(value: unknown, cityId: string, input: CityDeliveryPolicyPreviewInput): value is CityDeliveryPolicyPreview {
  return record(value) && fields(value, ["cityId", "version", "radiusMetres", "distanceMetres", "feeYer", "payable"]) &&
    value.cityId === cityId && value.version === input.expectedVersion && value.radiusMetres === input.radiusMetres &&
    value.distanceMetres === input.distanceMetres && value.payable === false &&
    typeof value.feeYer === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value.feeYer) &&
    BigInt(value.feeYer) <= BigInt(input.distanceMetres) * 100000n && (input.distanceMetres === 0 || value.feeYer !== "0");
}
export function isCityDeliveryPolicy(value: unknown, cityId: string): value is CityDeliveryPolicy {
  return record(value) && fields(value, Object.hasOwn(value, "distanceBands") ?
    ["cityId", "version", "radiusMetres", "updatedAt", "distanceBands"] : ["cityId", "version", "radiusMetres", "updatedAt"]) &&
    (!Object.hasOwn(value, "distanceBands") || isCityDeliveryDistanceBands(value.distanceBands)) &&
    value.cityId === cityId && integer(value.version, 1) && integer(value.radiusMetres, 1, 2147483647) && isDateTime(value.updatedAt);
}
export function isCityDeliveryPolicyState(value: unknown, cityId: string): value is CityDeliveryPolicyState {
  return isCityDeliveryPolicy(value, cityId) ||
    (record(value) && fields(value, ["cityId", "version"]) && value.cityId === cityId && value.version === 0);
}
function deliverySubmission(value: unknown): CityDeliveryPolicyChange | null {
  if (!record(value) || !fields(value, ["operationId", "expectedVersion", "radiusMetres", "distanceBands", "reason"])) return null;
  const { operationId, expectedVersion, radiusMetres, reason } = value;
  const distanceBands = captureBands(value.distanceBands);
  if (!operationValid(operationId) || !integer(expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1) ||
    !integer(radiusMetres, 1, 2147483647) || !distanceBands || !reasonValid(reason)) return null;
  return { operationId, expectedVersion, radiusMetres, distanceBands, reason };
}
export function isCityDeliveryPolicyChange(value: unknown): value is CityDeliveryPolicyChange {
  return deliverySubmission(value) !== null;
}
export function matchesCityDeliveryPolicy(policy: CityDeliveryPolicy, change: CityDeliveryPolicyChange): boolean {
  return policy.version === change.expectedVersion + 1 && policy.radiusMetres === change.radiusMetres &&
    !!policy.distanceBands && policy.distanceBands.length === change.distanceBands.length &&
    policy.distanceBands.every((band, index) => band.upToMeters === change.distanceBands[index]?.upToMeters &&
      band.ratePerKmMinor === change.distanceBands[index]?.ratePerKmMinor);
}
export function isCityDeliveryPolicyResult(value: unknown, cityId: string, change: CityDeliveryPolicyChange): value is CityDeliveryPolicyResult {
  return envelope(value) && isCityDeliveryPolicy(value.policy, cityId) && matchesCityDeliveryPolicy(value.policy, change);
}
export async function getCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, signal?: AbortSignal,
): Promise<CityDeliveryPolicyState> {
  if (!cityValid(cityId)) throw new DshPublicError(400, "CITY_ID_INVALID");
  const value = await privateOwnerRequest(baseUrl, cityPath("getCityDeliveryPolicy", cityId), bearer, "GET", undefined, signal);
  return admitRead(value, (body): body is CityDeliveryPolicyState => isCityDeliveryPolicyState(body, cityId), signal);
}
export async function previewCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, input: CityDeliveryPolicyPreviewInput, signal?: AbortSignal,
): Promise<CityDeliveryPolicyPreview> {
  const submitted = previewSubmission(input);
  if (!cityValid(cityId) || !submitted) invalid();
  const value = await privateOwnerRequest(baseUrl, cityPath("previewCityDeliveryPolicy", cityId), bearer, "POST", submitted, signal);
  return admitRead(value, (body): body is CityDeliveryPolicyPreview => isCityDeliveryPolicyPreview(body, cityId, submitted), signal);
}
export async function replaceCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, change: CityDeliveryPolicyChange, signal?: AbortSignal,
): Promise<CityDeliveryPolicyResult> {
  const submitted = deliverySubmission(change);
  if (!cityValid(cityId) || !submitted) invalid();
  const value = await privateOwnerRequest(baseUrl, cityPath("replaceCityDeliveryPolicy", cityId), bearer, "PATCH", submitted, signal);
  return admitWrite(value, (body): body is CityDeliveryPolicyResult => isCityDeliveryPolicyResult(body, cityId, submitted), signal);
}

export type CityFulfillmentMode = "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP";
export type CityFulfillmentRelation = "DIRECT" | "MARKETPLACE";
export type CityFulfillmentPolicy = Readonly<{
  cityId: string; relation: CityFulfillmentRelation; version: number; allowedModes: CityFulfillmentMode[];
  changedByActor?: string; reason?: string; updatedAt?: string;
}>;
export type CityFulfillmentPolicyChange = Readonly<{
  operationId: string; expectedVersion: number; allowedModes: CityFulfillmentMode[]; reason: string;
}>;
export type CityFulfillmentPolicyResult = Readonly<{ policy: CityFulfillmentPolicy; replay: boolean }>;
const fulfillmentModes: readonly CityFulfillmentMode[] = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];
function captureModes(value: unknown): CityFulfillmentMode[] | null {
  if (!Array.isArray(value) || value.length > fulfillmentModes.length) return null;
  const size = value.length;
  const result: CityFulfillmentMode[] = [];
  for (let index = 0; index < size; index++) {
    const item = value[index];
    if (!fulfillmentModes.includes(item) || result.includes(item)) return null;
    result.push(item);
  }
  return result;
}
function canonicalModes(modes: readonly CityFulfillmentMode[]): CityFulfillmentMode[] {
  return fulfillmentModes.filter(mode => modes.includes(mode));
}
function validFulfillmentScope(city: string, relation: string): boolean {
  return cityValid(city) && (relation === "DIRECT" || relation === "MARKETPLACE");
}
export function isCityFulfillmentPolicy(value: unknown, city: string, relation: CityFulfillmentRelation): value is CityFulfillmentPolicy {
  if (!validFulfillmentScope(city, relation) || !record(value) || value.cityId !== city ||
    value.relation !== relation || !integer(value.version, 0)) return false;
  const modes = captureModes(value.allowedModes);
  if (!modes || !canonicalModes(modes).every((mode, index) => mode === modes[index])) return false;
  if (value.version === 0) return fields(value, ["cityId", "relation", "version", "allowedModes"]) && modes.length === 0;
  return fields(value, ["cityId", "relation", "version", "allowedModes", "changedByActor", "reason", "updatedAt"]) &&
    actorValid(value.changedByActor) && reasonValid(value.reason, true) && ownerTrim(value.reason) === value.reason && isDateTime(value.updatedAt);
}
function fulfillmentSubmission(value: unknown): CityFulfillmentPolicyChange | null {
  if (!record(value) || !fields(value, ["operationId", "expectedVersion", "allowedModes", "reason"])) return null;
  const { operationId, expectedVersion, reason } = value;
  const allowedModes = captureModes(value.allowedModes);
  if (!operationValid(operationId) || !integer(expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1) ||
    !allowedModes || !reasonValid(reason, true)) return null;
  return { operationId, expectedVersion, allowedModes, reason };
}
export function isCityFulfillmentPolicyChange(value: unknown): value is CityFulfillmentPolicyChange {
  return fulfillmentSubmission(value) !== null;
}
export async function getCityFulfillmentPolicy(baseUrl: string, city: string, relation: CityFulfillmentRelation,
  bearer: string, signal?: AbortSignal): Promise<CityFulfillmentPolicy> {
  if (!validFulfillmentScope(city, relation)) invalid();
  const value = await privateOwnerRequest(baseUrl, cityPath("getCityFulfillmentPolicy", city, relation), bearer, "GET", undefined, signal);
  return admitRead(value, (body): body is CityFulfillmentPolicy => isCityFulfillmentPolicy(body, city, relation), signal);
}
export async function replaceCityFulfillmentPolicy(baseUrl: string, city: string, relation: CityFulfillmentRelation,
  bearer: string, change: CityFulfillmentPolicyChange, signal?: AbortSignal): Promise<CityFulfillmentPolicyResult> {
  const submitted = fulfillmentSubmission(change);
  if (!validFulfillmentScope(city, relation) || !submitted) invalid();
  const expected = canonicalModes(submitted.allowedModes);
  const value = await privateOwnerRequest(baseUrl, cityPath("replaceCityFulfillmentPolicy", city, relation), bearer, "PATCH", submitted, signal);
  return admitWrite(value, (body): body is CityFulfillmentPolicyResult =>
    envelope(body) && isCityFulfillmentPolicy(body.policy, city, relation) &&
    body.policy.version === submitted.expectedVersion + 1 && body.policy.reason === ownerTrim(submitted.reason) &&
    body.policy.allowedModes.length === expected.length &&
    expected.every((mode, index) => mode === (body.policy as CityFulfillmentPolicy).allowedModes[index]), signal);
}
