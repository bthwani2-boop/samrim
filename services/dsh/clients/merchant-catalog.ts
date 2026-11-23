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
    "id", "storeId", "productId", "name", "variantId", "priceYer", "stockUnits",
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
    ["productActive", "variantSellable", "requiredAttributesValid", "published", "available"]
      .every(k => typeof v[k] === "boolean");
}
export function parseMerchantCatalogPage(payload: unknown, actorId: string, storeId: string): MerchantCatalogPage {
  const value = object(payload);
  const items = Array.isArray(value?.items) ? value.items as MerchantCatalogOffer[] : null;
  if (!value || !items || !actorRule.test(actorId) || !key.test(storeId) ||
    (value.nextCursor === undefined ?
      !exactKeys(value, ["actorId", "storeId", "items"]) :
      !exactKeys(value, ["actorId", "storeId", "items", "nextCursor"])) ||
    value.actorId !== actorId || value.storeId !== storeId ||
    !Array.isArray(value.items) || items.length > 50 ||
    !items.every(item => validOffer(item, storeId)) ||
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

export async function listMerchantCatalog(
  origin: string, storeId: string, actorId: string, bearer: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<MerchantCatalogPage> {
  if (!key.test(storeId) || !actorRule.test(actorId) ||
    (options.cursor !== undefined && !key.test(options.cursor)) ||
    (options.limit !== undefined && (!Number.isInteger(options.limit) ||
      options.limit < 1 || options.limit > 50))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const path = dshOperations.listCurrentMerchantStoreCatalog.path.replace("{storeID}", storeId);
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  const body = await privateOwnerRequest(origin, path + (params.size ? `?${params}` : ""),
    bearer, "GET", undefined, options.signal);
  return parseMerchantCatalogPage(body, actorId, storeId);
}
