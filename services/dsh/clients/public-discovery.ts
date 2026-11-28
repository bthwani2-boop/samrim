/**
 * Contract-bound DSH public discovery reads. No Store, price or financial writers.
 * Public wire format: paths/stores.yaml and paths/offers.yaml in the DSH OpenAPI owner.
 */
import { configuredOrigin, consumeOwnerResponse, DshPublicError, endpoint, fetchOwnerHeaders, onlyKeys, readBoundedOwnerJSON } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";

export { DshPublicError } from "./client-core.ts";

const orderabilityStates = ["OPEN_FOR_ORDERS", "CLOSED_BY_SCHEDULE", "PAUSED", "OPERATIONALLY_UNAVAILABLE"] as const;
export interface PublicVertical {
  id: string;
  storeCount: number;
}
export interface PublicStore {
  id: string;
  name: string;
  cityId: string;
  verticalId: string;
  orderabilityStatus: (typeof orderabilityStates)[number];
  orderingAvailable: false;
}
export interface PublicOffer {
  id: string;
  storeId: string;
  name: string;
  variantId: string;
  priceYer: number | string;
  available: true;
}
export interface PublicOfferEstimate {
  storeId: string;
  offerId: string;
  variantId: string;
  quantity: number;
  unitYer: string;
  subtotalYer: string;
}
export interface PublicPage<T> {
  items: T[];
  nextCursor?: string;
  revision: number;
}

type Paging = { cursor?: string; limit?: number; signal?: AbortSignal };
type SearchPaging = Paging & { query?: string };

const publicId = /^[a-z0-9-]{1,64}$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/;
const maxSafePriceYer = BigInt(Number.MAX_SAFE_INTEGER);
const maxPriceYer = 9223372036854775807n;

function invalidReceipt(): DshPublicError {
  return new DshPublicError(502, "OWNER_RESPONSE_INVALID");
}
function assertCurrent(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function isPublicId(value: unknown): value is string {
  return typeof value === "string" && publicId.test(value);
}

/** Stable public Customer route, not publication or checkout authority. */
export function publicStorefrontPath(storeId: unknown): string | null {
  return isPublicId(storeId) ? `/storefront/${storeId}` : null;
}

/** Build a share destination only from the configured Customer origin. */
export function publicStorefrontUrl(storeId: unknown, origin?: unknown): string | null {
  const pathname = publicStorefrontPath(storeId);
  if (pathname === null) return null;
  try {
    return new URL(pathname, configuredOrigin(origin, "storefront")).href;
  } catch {
    return null;
  }
}
function boundedName(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length >= 1 && length <= maximum;
}
function isOrderability(value: unknown): value is PublicStore["orderabilityStatus"] {
  return typeof value === "string" && orderabilityStates.some(state => state === value);
}
function parsePositiveInt64(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= maxPriceYer ? amount : null;
}
export function isPublicOfferPriceYer(value: unknown): value is PublicOffer["priceYer"] {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  const amount = parsePositiveInt64(value);
  return amount !== null && amount > maxSafePriceYer;
}

async function ownerRead(url: URL, signal?: AbortSignal, requireCurrent = false): Promise<unknown> {
  assertCurrent(signal);
  let response: Response;
  try {
    response = await fetchOwnerHeaders(url.toString(), {
      method: "GET", signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    assertCurrent(signal);
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  return consumeOwnerResponse(response, async () => {
    assertCurrent(signal);
    if (!response.ok) {
      let code = "OWNER_READ_FAILED";
      try {
        const body = record(await readBoundedOwnerJSON(response, 4096, undefined, signal));
        if (body && typeof body.error === "string") code = body.error;
      } catch { /* keep the safe generic error */ }
      assertCurrent(signal);
      throw new DshPublicError(response.status, code);
    }
    const mediaType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    const length = response.headers.get("Content-Length");
    if (response.status !== 200 || mediaType !== "application/json" ||
      (requireCurrent && response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") ||
      (length !== null && Number(length) > 65536)) {
      throw invalidReceipt();
    }
    let value: unknown;
    try {
      value = await readBoundedOwnerJSON(response, 65536, undefined, signal);
    } catch {
      assertCurrent(signal);
      throw invalidReceipt();
    }
    assertCurrent(signal);
    return value;
  });
}

// Wire validators reject coercion and additional private fields. The owner
// remains responsible for publication, eligibility and inventory decisions.
function isStore(value: unknown): value is PublicStore {
  const v = record(value);
  return v !== null &&
    onlyKeys(v, ["id", "name", "cityId", "verticalId", "orderabilityStatus", "orderingAvailable"]) &&
    isPublicId(v.id) && boundedName(v.name, 120) && isPublicId(v.cityId) &&
    isPublicId(v.verticalId) && isOrderability(v.orderabilityStatus) && v.orderingAvailable === false;
}
function isVertical(value: unknown): value is PublicVertical {
  const v = record(value);
  return v !== null && onlyKeys(v, ["id", "storeCount"]) && isPublicId(v.id) &&
    typeof v.storeCount === "number" && Number.isSafeInteger(v.storeCount) && v.storeCount >= 1;
}
function isOffer(value: unknown): value is PublicOffer {
  const v = record(value);
  return v !== null &&
    onlyKeys(v, ["id", "storeId", "name", "variantId", "priceYer", "available"]) &&
    isPublicId(v.id) && isPublicId(v.storeId) && boundedName(v.name, 160) &&
    isPublicId(v.variantId) && isPublicOfferPriceYer(v.priceYer) && v.available === true;
}
function readPage<T>(
  value: unknown, options: Paging, validate: (v: unknown) => v is T,
  identity: (item: T) => string, inScope: (item: T) => boolean = () => true,
): PublicPage<T> {
  const v = record(value);
  if (!v || !onlyKeys(v, ["items", "revision", "nextCursor"]) ||
    !Array.isArray(v.items) || v.items.length > (options.limit ?? 20) ||
    typeof v.revision !== "number" || !Number.isSafeInteger(v.revision) || v.revision < 0 ||
    !v.items.every(validate)) throw invalidReceipt();
  const items: T[] = v.items;
  const ids = items.map(identity);
  const next = v.nextCursor;
  if (new Set(ids).size !== ids.length || !items.every(inScope) ||
    (next !== undefined && (typeof next !== "string" || !cursorPattern.test(next) ||
      items.length === 0 || next === options.cursor))) throw invalidReceipt();
  return { items, revision: v.revision, ...(typeof next === "string" ? { nextCursor: next } : {}) };
}

function validatePublicPaging(options: Paging): void {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new DshPublicError(400, "INVALID_LIMIT");
  }
  if (options.cursor !== undefined && (typeof options.cursor !== "string" || !cursorPattern.test(options.cursor))) {
    throw new DshPublicError(400, "INVALID_CURSOR");
  }
}
function validateStoreId(storeId: string): void {
  if (!isPublicId(storeId)) throw new DshPublicError(400, "INVALID_STORE");
}
function validateCityId(cityId: string): void {
  if (!isPublicId(cityId)) throw new DshPublicError(400, "INVALID_CITY");
}
function validatePublicSearch(query: string | undefined): void {
  // Reject invalid wire input before URLSearchParams replaces lone surrogates.
  if (query !== undefined && (typeof query !== "string" || Array.from(query).length > 80 ||
    query.includes("\u0000") || /[\uD800-\uDFFF]/u.test(query))) {
    throw new DshPublicError(400, "INVALID_SEARCH");
  }
}
function pageParameters(url: URL, options: Paging): void {
  if (options.cursor !== undefined) url.searchParams.set("cursor", options.cursor);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
}
function searchParameter(url: URL, options: SearchPaging): void {
  if (options.query !== undefined) url.searchParams.set("q", options.query);
}

export async function listPublicCities(baseUrl: string, options: Paging = {}): Promise<PublicPage<string>> {
  validatePublicPaging(options);
  const url = endpoint(baseUrl, dshOperations.listPublicCities.path);
  pageParameters(url, options);
  return readPage(await ownerRead(url, options.signal), options, isPublicId, id => id);
}

export async function listPublicVerticals(
  baseUrl: string, cityId: string, options: Paging = {},
): Promise<PublicPage<PublicVertical>> {
  validateCityId(cityId);
  validatePublicPaging(options);
  const url = endpoint(baseUrl, dshOperations.listPublicVerticals.path);
  url.searchParams.set("city_id", cityId);
  pageParameters(url, options);
  return readPage(await ownerRead(url, options.signal), options, isVertical, item => item.id);
}

export async function listPublicStores(
  baseUrl: string, cityId: string, options: SearchPaging & { verticalId?: string } = {},
): Promise<PublicPage<PublicStore>> {
  validateCityId(cityId);
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  if (options.verticalId !== undefined && !isPublicId(options.verticalId)) {
    throw new DshPublicError(400, "INVALID_VERTICAL");
  }
  const url = endpoint(baseUrl, dshOperations.listPublicStores.path);
  url.searchParams.set("city_id", cityId);
  searchParameter(url, options);
  if (options.verticalId !== undefined) url.searchParams.set("vertical_id", options.verticalId);
  pageParameters(url, options);
  return readPage(await ownerRead(url, options.signal), options, isStore, item => item.id,
    item => item.cityId === cityId && (options.verticalId === undefined || item.verticalId === options.verticalId));
}

export async function getPublicStore(baseUrl: string, storeId: string, signal?: AbortSignal): Promise<PublicStore> {
  validateStoreId(storeId);
  const url = endpoint(baseUrl, dshOperations.getPublicStore.path.replace("{id}", encodeURIComponent(storeId)));
  const value = await ownerRead(url, signal);
  if (!isStore(value) || value.id !== storeId) throw invalidReceipt();
  return value;
}

export async function listPublicOffers(
  baseUrl: string, storeId: string, options: SearchPaging = {},
): Promise<PublicPage<PublicOffer>> {
  validateStoreId(storeId);
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  const url = endpoint(baseUrl, dshOperations.listPublicOffers.path.replace("{id}", encodeURIComponent(storeId)));
  searchParameter(url, options);
  pageParameters(url, options);
  return readPage(await ownerRead(url, options.signal), options, isOffer, item => item.id,
    item => item.storeId === storeId);
}

export function parseOfferEstimateQuantity(raw: string): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const quantity = Number(raw);
  return quantity <= 2147483647 ? quantity : null;
}

export async function estimatePublicOffer(
  baseUrl: string, storeId: string, offerId: string, quantity: number, signal?: AbortSignal,
): Promise<PublicOfferEstimate> {
  validateStoreId(storeId);
  if (!isPublicId(offerId) || parseOfferEstimateQuantity(String(quantity)) !== quantity) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const path = dshOperations.estimatePublicOffer.path.replace("{id}", storeId).replace("{offerId}", offerId);
  const url = endpoint(baseUrl, path);
  url.searchParams.set("quantity", String(quantity));
  const v = record(await ownerRead(url, signal, true));
  if (!v || !onlyKeys(v, ["storeId", "offerId", "variantId", "quantity", "unitYer", "subtotalYer"]) ||
    v.storeId !== storeId || v.offerId !== offerId || !isPublicId(v.variantId) || v.quantity !== quantity ||
    typeof v.unitYer !== "string" || typeof v.subtotalYer !== "string" ||
    !/^[1-9][0-9]{0,28}$/.test(v.subtotalYer)) throw invalidReceipt();
  const unit = parsePositiveInt64(v.unitYer);
  if (unit === null || unit * BigInt(quantity) !== BigInt(v.subtotalYer)) throw invalidReceipt();
  return { storeId, offerId, variantId: v.variantId, quantity, unitYer: v.unitYer, subtotalYer: v.subtotalYer };
}
