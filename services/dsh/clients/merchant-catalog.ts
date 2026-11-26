/** Private DSH catalog projection. A Merchant role is not a Store grant. */
import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type MerchantCatalogOffer = Readonly<{
  id: string;
  storeId: string;
  productId: string;
  name: string;
  variantId: string;
  priceYer: string;
  stockUnits: number;
  draftVersion: number;
  productActive: boolean;
  variantSellable: boolean;
  requiredAttributesValid: boolean;
  published: boolean;
  available: boolean;
}>;
export type MerchantCatalogPage = Readonly<{
  actorId: string;
  storeId: string;
  items: MerchantCatalogOffer[];
  nextCursor?: string;
}>;

const key = /^[a-z0-9-]{1,64}$/;
const actorRule = /^\S.{0,127}$/u;
const money = /^(0|[1-9][0-9]{0,18})$/;
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));
}
function validOffer(value: unknown, storeId: string): value is MerchantCatalogOffer {
  const v = object(value);
  if (!v || !exactKeys(v, [
    "id", "storeId", "productId", "name", "variantId", "priceYer", "stockUnits", "draftVersion",
    "productActive", "variantSellable", "requiredAttributesValid", "published", "available",
  ])) return false;
  return typeof v.id === "string" && key.test(v.id) &&
    v.storeId === storeId &&
    typeof v.productId === "string" && v.productId.length > 0 && v.productId.length <= 128 &&
    typeof v.variantId === "string" && v.variantId.length > 0 && v.variantId.length <= 128 &&
    typeof v.name === "string" && v.name.trim().length > 0 &&
    [...v.name].length <= 160 &&
    typeof v.priceYer === "string" && money.test(v.priceYer) &&
    BigInt(v.priceYer) <= 9223372036854775807n &&
    typeof v.stockUnits === "number" && Number.isSafeInteger(v.stockUnits) && v.stockUnits >= 0 &&
    typeof v.draftVersion === "number" && Number.isSafeInteger(v.draftVersion) && v.draftVersion >= 1 &&
    ["productActive", "variantSellable", "requiredAttributesValid", "published", "available"]
      .every(k => typeof v[k] === "boolean");
}
export type MerchantCatalogStatus = "published" | "unpublished" | "available" | "unavailable" | "stockout";

export function validMerchantCatalogStatus(value: unknown): value is MerchantCatalogStatus {
  return value === "published" || value === "unpublished" || value === "available" ||
    value === "unavailable" || value === "stockout";
}

function matchesStatus(offer: MerchantCatalogOffer, status: MerchantCatalogStatus): boolean {
  const available = offer.published && offer.available && offer.productActive &&
    offer.variantSellable && offer.requiredAttributesValid && BigInt(offer.priceYer) > 0n && offer.stockUnits > 0;
  switch (status) {
    case "published": return offer.published;
    case "unpublished": return !offer.published;
    case "available": return available;
    case "unavailable": return offer.published && !available;
    case "stockout": return offer.published && offer.stockUnits === 0;
  }
}

export function parseMerchantCatalogPage(payload: unknown, actorId: string, storeId: string,
  status?: MerchantCatalogStatus): MerchantCatalogPage {
  const value = object(payload);
  const items = Array.isArray(value?.items) ? value.items as MerchantCatalogOffer[] : null;
  if (!value || !items || !actorRule.test(actorId) || !key.test(storeId) ||
    (value.nextCursor === undefined ?
      !exactKeys(value, ["actorId", "storeId", "items"]) :
      !exactKeys(value, ["actorId", "storeId", "items", "nextCursor"])) ||
    value.actorId !== actorId || value.storeId !== storeId ||
    !Array.isArray(value.items) || items.length > 50 ||
    !items.every(item => validOffer(item, storeId)) ||
    (status !== undefined && (!validMerchantCatalogStatus(status) || !items.every(item => matchesStatus(item, status)))) ||
    new Set(items.map((item: MerchantCatalogOffer) => item.id)).size !== items.length ||
    items.some((item: MerchantCatalogOffer, i: number) =>
      i > 0 && item.id <= (items[i-1]?.id ?? "")) ||
    (value.nextCursor !== undefined &&
      (typeof value.nextCursor !== "string" || !key.test(value.nextCursor) ||
        items.length === 0 || value.nextCursor !== value.items[items.length-1]?.id))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return value as MerchantCatalogPage;
}

export function validMerchantCatalogSearch(query: string): boolean {
  return Array.from(query).length <= 80 && !query.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(query);
}

export async function listMerchantCatalog(
  origin: string, storeId: string, actorId: string, bearer: string,
  options: { cursor?: string; limit?: number; query?: string; status?: MerchantCatalogStatus; signal?: AbortSignal } = {},
): Promise<MerchantCatalogPage> {
  if (!key.test(storeId) || !actorRule.test(actorId) ||
    (options.query !== undefined && !validMerchantCatalogSearch(options.query)) ||
    (options.status !== undefined && !validMerchantCatalogStatus(options.status)) ||
    (options.cursor !== undefined && !key.test(options.cursor)) ||
    (options.limit !== undefined && (!Number.isInteger(options.limit) ||
      options.limit < 1 || options.limit > 50))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const path = dshOperations.listCurrentMerchantStoreCatalog.path.replace("{storeID}", storeId);
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.query?.trim()) params.set("q", options.query);
  if (options.status !== undefined) params.set("status", options.status);
  const body = await privateOwnerRequest(origin, path + (params.size ? `?${params}` : ""),
    bearer, "GET", undefined, options.signal);
  return parseMerchantCatalogPage(body, actorId, storeId, options.status);
}

export type MerchantCatalogDraftChange = Readonly<{
  operationId: string;
  name: string;
  priceYer: string;
  stockUnits: number;
}>;
export type MerchantCatalogDraftResult = Readonly<{
  offer: MerchantCatalogOffer;
  replay: boolean;
}>;
const operation = /^[A-Za-z0-9._-]{8,128}$/;

export function validMerchantCatalogDraft(input: MerchantCatalogDraftChange): boolean {
  if (!input || typeof input.name !== "string" || typeof input.operationId !== "string") return false;
  const name = input.name.trim();
  return operation.test(input.operationId) &&
    name.length > 0 && [...name].length <= 160 &&
    ![...name].some(char => { const code = char.codePointAt(0) ?? 0; return code < 32 || code === 127; }) &&
    typeof input.priceYer === "string" && /^[1-9][0-9]{0,18}$/.test(input.priceYer) &&
    BigInt(input.priceYer) <= 9223372036854775807n &&
    typeof input.stockUnits === "number" && Number.isInteger(input.stockUnits) &&
    input.stockUnits >= 0 && input.stockUnits <= 2147483647;
}
export function parseMerchantCatalogDraftResult(
  payload: unknown, storeId: string, input: MerchantCatalogDraftChange,
): MerchantCatalogDraftResult {
  const value = object(payload);
  if (!value || !exactKeys(value, ["offer", "replay"]) ||
    typeof value.replay !== "boolean" || !validOffer(value.offer, storeId)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const offer = value.offer;
  if (offer.name !== input.name.trim() ||
    offer.priceYer !== input.priceYer || offer.stockUnits !== input.stockUnits ||
    offer.draftVersion !== 1 || offer.published || offer.available || offer.productActive ||
    offer.variantSellable || offer.requiredAttributesValid) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return value as MerchantCatalogDraftResult;
}
export async function createMerchantCatalogDraft(
  origin: string, storeId: string, bearer: string, change: MerchantCatalogDraftChange,
  signal?: AbortSignal,
): Promise<MerchantCatalogDraftResult> {
  if (!key.test(storeId) || !validMerchantCatalogDraft(change)) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  const path = dshOperations.createCurrentMerchantCatalogDraft.path.replace("{storeID}", storeId);
  const body = await privateOwnerRequest(origin, path, bearer, "POST", change, signal, [200, 201]);
  return parseMerchantCatalogDraftResult(body, storeId, change);
}

export type MerchantCatalogDraftEditChange = Readonly<MerchantCatalogDraftChange & {
  expectedVersion: number;
}>;
export type MerchantCatalogDraftEditResult = MerchantCatalogDraftResult;

export function validMerchantCatalogDraftEdit(input: MerchantCatalogDraftEditChange): boolean {
  return validMerchantCatalogDraft(input) &&
    Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1 && input.expectedVersion < Number.MAX_SAFE_INTEGER;
}
export function parseMerchantCatalogDraftEditResult(
  payload: unknown, storeId: string, offerId: string,
  input: MerchantCatalogDraftEditChange,
): MerchantCatalogDraftEditResult {
  const value = object(payload);
  if (!value || !exactKeys(value, ["offer", "replay"]) ||
    typeof value.replay !== "boolean" || !validOffer(value.offer, storeId)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const offer = value.offer;
  if (offer.id !== offerId ||
    offer.draftVersion !== input.expectedVersion + 1 ||
    offer.name !== input.name.trim() ||
    offer.priceYer !== input.priceYer || offer.stockUnits !== input.stockUnits ||
    offer.published || offer.available || offer.productActive ||
    offer.variantSellable || offer.requiredAttributesValid) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return value as MerchantCatalogDraftEditResult;
}
export async function updateMerchantCatalogDraft(
  origin: string, storeId: string, offerId: string, bearer: string,
  change: MerchantCatalogDraftEditChange, signal?: AbortSignal,
): Promise<MerchantCatalogDraftEditResult> {
  if (!key.test(storeId) || !key.test(offerId) || !validMerchantCatalogDraftEdit(change)) {
    throw new DshPublicError(400, "INVALID_STORE_DRAFT");
  }
  const path = dshOperations.updateCurrentMerchantCatalogDraft.path
    .replace("{storeID}", storeId).replace("{offerID}", offerId);
  const body = await privateOwnerRequest(origin, path, bearer, "PATCH", change, signal);
  return parseMerchantCatalogDraftEditResult(body, storeId, offerId, change);
}

export type MerchantInventorySummary = Readonly<{
  actorId: string;
  storeId: string;
  totalOffers: number;
  publishedOffers: number;
  availableOffers: number;
  unavailableOffers: number;
  stockoutOffers: number;
}>;

export function parseMerchantInventorySummary(
  payload: unknown, actorId: string, storeId: string,
): MerchantInventorySummary {
  const value = object(payload);
  const counts = ["totalOffers", "publishedOffers", "availableOffers", "unavailableOffers", "stockoutOffers"];
  if (!value || !exactKeys(value, ["actorId", "storeId", ...counts]) ||
    !actorRule.test(actorId) || !key.test(storeId) ||
    value.actorId !== actorId || value.storeId !== storeId ||
    !counts.every(name => typeof value[name] === "number" &&
      Number.isSafeInteger(value[name]) && (value[name] as number) >= 0)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const summary = value as MerchantInventorySummary;
  if (summary.publishedOffers > summary.totalOffers ||
    summary.availableOffers > summary.publishedOffers ||
    summary.unavailableOffers !== summary.publishedOffers - summary.availableOffers ||
    summary.stockoutOffers > summary.unavailableOffers) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return summary;
}

export async function readMerchantInventorySummary(
  origin: string, storeId: string, actorId: string, bearer: string, signal?: AbortSignal,
): Promise<MerchantInventorySummary> {
  if (!key.test(storeId) || !actorRule.test(actorId)) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const path = dshOperations.readCurrentMerchantInventorySummary.path.replace("{storeID}", storeId);
  return parseMerchantInventorySummary(
    await privateOwnerRequest(origin, path, bearer, "GET", undefined, signal), actorId, storeId);
}
