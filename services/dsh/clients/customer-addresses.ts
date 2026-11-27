import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type CustomerAddress = Readonly<{
  id: string;
  cityId: string;
  label: string;
  details: string;
  latitude: number;
  longitude: number;
  version: number;
}>;
export type CustomerAddressChange = Readonly<Omit<CustomerAddress, "id" | "version"> & { expectedVersion: number }>;
export type CustomerAddressPage = Readonly<{ actorId: string; items: CustomerAddress[]; nextCursor?: string }>;
export type CustomerAddressRead = Readonly<{ actorId: string; address: CustomerAddress }>;
export type CustomerAddressResult = Readonly<{ actorId: string; address: CustomerAddress; replay: boolean }>;
export type DeliveryServiceability = Readonly<{
  actorId: string;
  storeId: string;
  addressId: string;
  status: "SERVICEABLE" | "UNSERVICEABLE" | "UNAVAILABLE";
  evidence?: Readonly<{
    storeCityId: string;
    addressCityId: string;
    addressVersion: number;
    policyVersion: number;
    radiusMetres: number;
    distanceMetres: number;
  }>;
}>;

const idRule = /^addr-[a-f0-9]{32}$/;
const resourceRule = /^[a-z0-9-]{1,64}$/;
const bearerRule = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const pageLimit = 20;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function resource(value: unknown): value is string {
  return typeof value === "string" && resourceRule.test(value);
}
export function isCustomerAddressId(id: string): boolean {
  return typeof id === "string" && idRule.test(id);
}
function coordinate(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
// The DSH Go owner uses strings.TrimSpace (Unicode White_Space), not JS trim.
function ownerTrim(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
function normalizedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || /\p{Cs}/u.test(value) || [...value].length > max) return undefined;
  const normalized = ownerTrim(value);
  return normalized.length > 0 && !/\p{Cc}/u.test(normalized) ? normalized : undefined;
}
function canonicalText(value: unknown, max: number): boolean {
  return typeof value === "string" && normalizedText(value, max) === value;
}
function snapshot(value: unknown): CustomerAddressChange | undefined {
  if (!record(value) || !exact(value, ["cityId", "label", "details", "latitude", "longitude", "expectedVersion"])) return undefined;
  const { cityId, label, details, latitude, longitude, expectedVersion } = value;
  const canonicalLabel = normalizedText(label, 80);
  const canonicalDetails = normalizedText(details, 300);
  if (!resource(cityId) || canonicalLabel === undefined || canonicalDetails === undefined ||
    !coordinate(latitude, 90) || !coordinate(longitude, 180) || !integer(expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1)) {
    return undefined;
  }
  return { cityId, label: canonicalLabel, details: canonicalDetails, latitude, longitude, expectedVersion };
}
export function validCustomerAddressChange(value: unknown): value is CustomerAddressChange {
  return snapshot(value) !== undefined;
}
function addressRecord(value: unknown): value is CustomerAddress {
  return record(value) && exact(value, ["id", "cityId", "label", "details", "latitude", "longitude", "version"]) &&
    typeof value.id === "string" && isCustomerAddressId(value.id) && resource(value.cityId) &&
    canonicalText(value.label, 80) && canonicalText(value.details, 300) &&
    coordinate(value.latitude, 90) && coordinate(value.longitude, 180) && integer(value.version, 1);
}
function invalidResponse(): never {
  throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
}
function unknownResult(): never {
  throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
}
function requireBearer(bearer: string): void {
  if (typeof bearer !== "string" || !bearerRule.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
}
function requireRequest(valid: boolean): void {
  if (!valid) throw new DshPublicError(400, "INVALID_REQUEST");
}
function ensureCurrent(signal: AbortSignal | undefined, mutating = false): void {
  if (signal?.aborted) throw new DshPublicError(0, mutating ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
}

export function parseCustomerAddressPage(value: unknown, actor: string, after = ""): CustomerAddressPage {
  if (!record(value) || !exact(value, Object.hasOwn(value, "nextCursor") ? ["actorId", "items", "nextCursor"] : ["actorId", "items"]) ||
    value.actorId !== actor || !Array.isArray(value.items) || value.items.length > pageLimit) invalidResponse();
  let previous = after;
  for (const item of value.items) {
    if (!addressRecord(item) || item.id <= previous) invalidResponse();
    previous = item.id;
  }
  if (Object.hasOwn(value, "nextCursor") && (value.items.length !== pageLimit || value.nextCursor !== previous)) invalidResponse();
  return value as CustomerAddressPage;
}
export function parseCustomerAddress(value: unknown, actor: string, id: string): CustomerAddressRead {
  if (!record(value) || !exact(value, ["actorId", "address"]) || value.actorId !== actor ||
    !addressRecord(value.address) || value.address.id !== id) invalidResponse();
  return { actorId: actor, address: value.address };
}
export function parseCustomerAddressResult(value: unknown, actor: string, id: string, change: CustomerAddressChange): CustomerAddressResult {
  const command = snapshot(change);
  if (!command || !record(value) || !exact(value, ["actorId", "address", "replay"]) || value.actorId !== actor ||
    typeof value.replay !== "boolean" || !addressRecord(value.address)) unknownResult();
  const address = value.address;
  if (address.id !== id || address.version !== command.expectedVersion + 1 || address.cityId !== command.cityId ||
    address.label !== command.label || address.details !== command.details ||
    address.latitude !== command.latitude || address.longitude !== command.longitude) unknownResult();
  return { actorId: actor, address, replay: value.replay };
}
export async function listCustomerAddresses(origin: string, bearer: string, actor: string, after?: string, signal?: AbortSignal) {
  requireBearer(bearer);
  requireRequest(after === undefined || isCustomerAddressId(after));
  const path = dshOperations.listCurrentCustomerAddresses.path;
  const value = await privateOwnerRequest(origin, after ? path + "?after=" + after : path, bearer, "GET", undefined, signal);
  ensureCurrent(signal);
  return parseCustomerAddressPage(value, actor, after);
}
export async function getCustomerAddress(origin: string, bearer: string, actor: string, id: string, signal?: AbortSignal) {
  requireBearer(bearer);
  requireRequest(isCustomerAddressId(id));
  const path = dshOperations.getCurrentCustomerAddress.path.replace("{addressID}", id);
  const value = await privateOwnerRequest(origin, path, bearer, "GET", undefined, signal);
  ensureCurrent(signal);
  return parseCustomerAddress(value, actor, id);
}
export async function saveCustomerAddress(origin: string, bearer: string, actor: string, id: string, change: CustomerAddressChange, signal?: AbortSignal) {
  requireBearer(bearer);
  const command = snapshot(change);
  if (!isCustomerAddressId(id) || !command) throw new DshPublicError(400, "INVALID_REQUEST");
  const path = dshOperations.saveCurrentCustomerAddress.path.replace("{addressID}", id);
  const value = await privateOwnerRequest(origin, path, bearer, "PUT", command, signal);
  ensureCurrent(signal, true);
  return parseCustomerAddressResult(value, actor, id, command);
}
export function parseDeliveryServiceability(value: unknown, actor: string, store: string, address: string): DeliveryServiceability {
  if (!record(value) || value.actorId !== actor || value.storeId !== store || value.addressId !== address) invalidResponse();
  if (value.status === "UNAVAILABLE") {
    if (!exact(value, ["actorId", "storeId", "addressId", "status"])) invalidResponse();
    return { actorId: actor, storeId: store, addressId: address, status: value.status };
  }
  if ((value.status !== "SERVICEABLE" && value.status !== "UNSERVICEABLE") ||
    !exact(value, ["actorId", "storeId", "addressId", "status", "evidence"])) invalidResponse();
  const evidence = value.evidence;
  if (!record(evidence) || !exact(evidence, ["storeCityId", "addressCityId", "addressVersion", "policyVersion", "radiusMetres", "distanceMetres"]) ||
    !resource(evidence.storeCityId) || !resource(evidence.addressCityId) ||
    !integer(evidence.addressVersion, 1) || !integer(evidence.policyVersion, 1) || !integer(evidence.radiusMetres, 1, 2147483647) ||
    typeof evidence.distanceMetres !== "number" || !Number.isFinite(evidence.distanceMetres) || evidence.distanceMetres < 0) invalidResponse();
  const serviceable = evidence.storeCityId === evidence.addressCityId && evidence.distanceMetres <= evidence.radiusMetres;
  if (serviceable !== (value.status === "SERVICEABLE")) invalidResponse();
  return {
    actorId: actor, storeId: store, addressId: address, status: value.status,
    evidence: {
      storeCityId: evidence.storeCityId, addressCityId: evidence.addressCityId,
      addressVersion: evidence.addressVersion, policyVersion: evidence.policyVersion,
      radiusMetres: evidence.radiusMetres, distanceMetres: evidence.distanceMetres,
    },
  };
}
export async function evaluateDeliveryServiceability(origin: string, bearer: string, actor: string, store: string, address: string, signal?: AbortSignal) {
  requireBearer(bearer);
  requireRequest(resource(store) && isCustomerAddressId(address));
  const path = dshOperations.evaluateCurrentCustomerDeliveryAddress.path.replace("{storeID}", store);
  const value = await privateOwnerRequest(origin, path + "?addressId=" + address, bearer, "GET", undefined, signal);
  ensureCurrent(signal);
  return parseDeliveryServiceability(value, actor, store, address);
}
