/**
 * Contract-bound DSH public discovery reads. No Store, price or financial writers.
 * Public wire format: paths/stores.yaml and paths/offers.yaml in the DSH OpenAPI owner.
 */
import { DshPublicError, endpoint, onlyKeys, readBoundedOwnerJSON } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";

export { DshPublicError } from "./client-core.ts";
export interface PublicVertical {
  id: string;
  storeCount: number;
}
export interface PublicStore {
  id: string;
  name: string;
  cityId: string;
  verticalId: string;
  orderabilityStatus: "OPEN_FOR_ORDERS" | "CLOSED_BY_SCHEDULE" | "PAUSED" | "OPERATIONALLY_UNAVAILABLE";
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
async function ownerRead(url: URL, signal?: AbortSignal, requireCurrent = false): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET", signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  if (!response.ok) {
    let code = "OWNER_READ_FAILED";
    try {
      const data: unknown = await readBoundedOwnerJSON(response, 4096, undefined, signal);
      if (data && typeof data === "object" && "error" in data && typeof data.error === "string") code = data.error;
    } catch { /* keep the safe generic error */ }
    if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
    throw new DshPublicError(response.status, code);
  }
  // A successful public owner read must obey the DSH JSON wire contract.
  // Bound the decoded payload before interpreting it as a Store or Offer.
  const mediaType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("Content-Length");
  if (mediaType !== "application/json" ||
    (requireCurrent && (response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store")) ||
    (contentLength !== null && Number(contentLength) > 65536)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    body = await readBoundedOwnerJSON(response, 65536, undefined, signal);
  } catch {
    if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return body;
}
// Enforce the actual public OpenAPI schema at the client trust boundary.
// A TypeScript interface does not remove extra JSON keys or validate wire data.
const publicId = /^[a-z0-9-]{1,64}$/;
function isPublicId(value: unknown): value is string {
  return typeof value === "string" && publicId.test(value);
}
function boundedName(value: unknown, maxCodePoints: number): value is string {
  return typeof value === "string" && Array.from(value).length >= 1 &&
    Array.from(value).length <= maxCodePoints;
}
function isStore(value: unknown): value is PublicStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "name", "cityId", "verticalId", "orderabilityStatus", "orderingAvailable"]) &&
    isPublicId(v.id) && boundedName(v.name, 120) &&
    isPublicId(v.cityId) && isPublicId(v.verticalId) &&
    ["OPEN_FOR_ORDERS", "CLOSED_BY_SCHEDULE", "PAUSED", "OPERATIONALLY_UNAVAILABLE"].includes(String(v.orderabilityStatus)) &&
    v.orderingAvailable === false;
}
function isVertical(value: unknown): value is PublicVertical {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "storeCount"]) && isPublicId(v.id) &&
    Number.isSafeInteger(v.storeCount) && Number(v.storeCount) >= 1;
}
const maxSafePriceYer = BigInt(Number.MAX_SAFE_INTEGER);
const maxPriceYer = 9223372036854775807n;

export function isPublicOfferPriceYer(value: unknown): value is PublicOffer["priceYer"] {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  if (typeof value !== "string" || !/^[1-9][0-9]{15,18}$/.test(value)) return false;
  const amount = BigInt(value);
  return amount > maxSafePriceYer && amount <= maxPriceYer;
}

function isOffer(value: unknown): value is PublicOffer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "storeId", "name", "variantId", "priceYer", "available"]) &&
    isPublicId(v.id) && isPublicId(v.storeId) && boundedName(v.name, 160) &&
    isPublicId(v.variantId) &&
    isPublicOfferPriceYer(v.priceYer) && v.available === true;
}
function readPage<T>(value: unknown, validate: (v: unknown) => v is T): PublicPage<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const v = value as Record<string, unknown>;
  if (!onlyKeys(v, ["items", "revision", "nextCursor"]) ||
    !Array.isArray(v.items) || !v.items.every(validate) ||
    !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 ||
    (v.nextCursor !== undefined &&
      (typeof v.nextCursor !== "string" || v.nextCursor.length > 512))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return { items: v.items, revision: v.revision as number, ...(typeof v.nextCursor === "string" ? { nextCursor: v.nextCursor } : {}) };
}
// Pages carry DSH's revision-bound opaque keyset continuation. A duplicate
// item or non-advancing cursor is never a safe next page for a Customer list.
function validPublicContinuation<T>(
  page: PublicPage<T>, cursor: string | undefined, identity: (item: T) => string,
): boolean {
  const ids = page.items.map(identity);
  return new Set(ids).size === ids.length &&
    (page.nextCursor === undefined ||
      (page.items.length > 0 && page.nextCursor !== cursor &&
        /^[A-Za-z0-9_-]{1,512}$/.test(page.nextCursor)));
}

function validatePublicPaging(options: { cursor?: string; limit?: number }): void {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new DshPublicError(400, "INVALID_LIMIT");
  }
  if (options.cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(options.cursor)) {
    throw new DshPublicError(400, "INVALID_CURSOR");
  }
}

function validateStoreId(storeId: string): void {
  if (!isPublicId(storeId)) throw new DshPublicError(400, "INVALID_STORE");
}

export async function listPublicCities(
  baseUrl: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<string>> {
  validatePublicPaging(options);
  const url = endpoint(baseUrl, dshOperations.listPublicCities.path);
  if (options.cursor !== undefined) url.searchParams.set("cursor", options.cursor);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isPublicId);
  if (page.items.length > (options.limit ?? 20) ||
    !validPublicContinuation(page, options.cursor, id => id)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}

export async function listPublicVerticals(
  baseUrl: string, cityId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicVertical>> {
  if (!isPublicId(cityId)) throw new DshPublicError(400, "INVALID_CITY");
  validatePublicPaging(options);
  const url = endpoint(baseUrl, dshOperations.listPublicVerticals.path);
  url.searchParams.set("city_id", cityId);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isVertical);
  if (page.items.length > (options.limit ?? 20) ||
    !validPublicContinuation(page, options.cursor, item => item.id)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}

export async function listPublicStores(
  baseUrl: string, cityId: string, options: { query?: string; verticalId?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicStore>> {
  if (!isPublicId(cityId)) throw new DshPublicError(400, "INVALID_CITY");
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  if (options.verticalId !== undefined && !isPublicId(options.verticalId)) {
    throw new DshPublicError(400, "INVALID_VERTICAL");
  }
  const url = endpoint(baseUrl, dshOperations.listPublicStores.path);
  url.searchParams.set("city_id", cityId);
  if (options.query !== undefined) url.searchParams.set("q", options.query);
  if (options.verticalId !== undefined) url.searchParams.set("vertical_id", options.verticalId);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isStore);
  if (page.items.length > (options.limit ?? 20) ||
    !validPublicContinuation(page, options.cursor, item => item.id) ||
    page.items.some((store) => store.cityId !== cityId ||
    (options.verticalId !== undefined && store.verticalId !== options.verticalId))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}
export async function getPublicStore(baseUrl: string, storeId: string, signal?: AbortSignal): Promise<PublicStore> {
  validateStoreId(storeId);
  const url = endpoint(baseUrl, dshOperations.getPublicStore.path.replace("{id}", encodeURIComponent(storeId)));
  const value = await ownerRead(url, signal);
  if (!isStore(value) || value.id !== storeId) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return value;
}
export async function listPublicOffers(
  baseUrl: string, storeId: string, options: { query?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicOffer>> {
  validateStoreId(storeId);
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  const url = endpoint(baseUrl, dshOperations.listPublicOffers.path.replace("{id}", encodeURIComponent(storeId)));
  if (options.query !== undefined) url.searchParams.set("q", options.query);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isOffer);
  if (page.items.length > (options.limit ?? 20) ||
    !validPublicContinuation(page, options.cursor, item => item.id) ||
    page.items.some((offer) => offer.storeId !== storeId)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}

export function parseOfferEstimateQuantity(raw: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
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
  const value = await ownerRead(url, signal, true);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const body = value as Record<string, unknown>;
    if (onlyKeys(body, ["storeId", "offerId", "variantId", "quantity", "unitYer", "subtotalYer"]) &&
      body.storeId === storeId && body.offerId === offerId && isPublicId(body.variantId) &&
      body.quantity === quantity && typeof body.unitYer === "string" && /^[1-9][0-9]{0,18}$/.test(body.unitYer) &&
      typeof body.subtotalYer === "string" && /^[1-9][0-9]{0,28}$/.test(body.subtotalYer) &&
      BigInt(body.unitYer) * BigInt(quantity) === BigInt(body.subtotalYer)) {
      return { storeId, offerId, variantId: body.variantId, quantity, unitYer: body.unitYer, subtotalYer: body.subtotalYer };
    }
  }
  throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
}

function validatePublicSearch(query: string | undefined): void {
  // Check the wire value before URLSearchParams can replace lone surrogates.
  // OpenAPI maxLength counts Unicode code points, including surrounding space.
  if (query !== undefined && (Array.from(query).length > 80 ||
    query.includes("\u0000") || /[\uD800-\uDFFF]/u.test(query))) {
    throw new DshPublicError(400, "INVALID_SEARCH");
  }
}
