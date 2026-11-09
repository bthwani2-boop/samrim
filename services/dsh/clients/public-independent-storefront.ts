import { dshOperationPaths } from "./generated/dsh-operations";

// Public read contract only. DSH decides Store relationship, reviewed
// publication, approved media and legal terms. Never use private previews.
export type IndependentPublicStore = Readonly<{
  storeId: string;
  serviceCityId: string;
  name: string;
  hostingTermsVersion: string;
  merchantPolicyVersion: string;
  profileImageUri: string;
  coverImageUri: string;
  businessPhoneE164?: string;
  businessEmail?: string;
  businessWhatsAppE164?: string;
  cancellationTerms?: string;
  returnsTerms?: string;
  fulfillmentTerms?: string;
  collectionTerms?: string;
  checkoutEnabled: false;
}>;

export type IndependentPublicOffer = Readonly<{
  offerId: string;
  productId: string;
  productName: string;
  productDescription?: string;
  variantId: string;
  variantTitle: string;
  priceMinor: number;
  currency: "YER";
  baseUnit: "COUNT" | "GRAM" | "MILLILITER";
  pricingBasis: "PER_UNIT" | "PER_MEASURE";
  pricingUnitBaseUnits: number;
  media: ReadonlyArray<Readonly<{ uri: string; role: string }>>;
}>;

export type IndependentPublicCatalog = Readonly<{
  storeId: string;
  offers: ReadonlyArray<IndependentPublicOffer>;
  nextCursor: string;
}>;

export class IndependentStoreUnavailable extends Error {
  readonly status = 404;
}

const validID = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
function publicMedia(uri: unknown): boolean {
  if (!text(uri) || uri.trim() !== uri) return false;
  try {
    const value = new URL(uri);
    return value.protocol === "https:" && !!value.hostname && !value.username && !value.password && !value.hash &&
      value.hostname !== "localhost" && !value.hostname.endsWith(".local") && !value.hostname.endsWith(".internal");
  } catch { return false; }
}

async function readJSON(baseURL: string, path: string, signal?: AbortSignal): Promise<unknown> {
  const base = baseURL.trim();
  if (!base) throw new Error("DSH_BASE_URL_REQUIRED");
  const response = await fetch(base.replace(new RegExp("/+$"), "") + path, {
    method: "GET", cache: "no-store", credentials: "omit",
    headers: { Accept: "application/json" }, ...(signal ? { signal } : {}),
  });
  if (response.status === 404 || response.status === 403) throw new IndependentStoreUnavailable("NOT_PUBLISHED");
  if (!response.ok) {
    const error = new Error("INDEPENDENT_PUBLIC_READ_FAILED") as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function readPublishedIndependentWebStore(
  baseURL: string, storeID: string, cityID: string, signal?: AbortSignal,
): Promise<IndependentPublicStore> {
  if (!validID(storeID) || !validID(cityID)) throw new IndependentStoreUnavailable("INVALID_SCOPE");
  const path = dshOperationPaths.readPublishedIndependentWebStore.path.replace("{storeId}", encodeURIComponent(storeID));
  const value = await readJSON(baseURL, path + "?serviceCityId=" + encodeURIComponent(cityID), signal);
  if (!object(value) || value.storeId !== storeID || value.serviceCityId !== cityID ||
      !text(value.name) || !text(value.hostingTermsVersion) || !text(value.merchantPolicyVersion) ||
      !value.hostingTermsVersion.trim() || !value.merchantPolicyVersion.trim() ||
      !publicMedia(value.coverImageUri) || !publicMedia(value.profileImageUri) ||
      value.checkoutEnabled !== false) throw new IndependentStoreUnavailable("INVALID_PUBLIC_STORE");
  return value as IndependentPublicStore;
}

export async function listPublishedIndependentWebCatalog(
  baseURL: string, storeID: string, cityID: string,
  options: Readonly<{ categoryID?: string; productID?: string; query?: string; cursor?: string; signal?: AbortSignal }> = {},
): Promise<IndependentPublicCatalog> {
  const query = options.query?.trim() ?? "";
  const cursor = options.cursor ?? "";
  if (!validID(storeID) || !validID(cityID) ||
      (options.categoryID && !validID(options.categoryID)) ||
      (options.productID && !validID(options.productID)) ||
      [...query].length > 160 || cursor.length > 2048)
    throw new IndependentStoreUnavailable("INVALID_SCOPE");
  const path = dshOperationPaths.listPublishedIndependentWebCatalog.path.replace("{storeId}", encodeURIComponent(storeID));
  const params = new URLSearchParams({ serviceCityId: cityID, limit: "24" });
  if (query) params.set("q", query);
  if (options.categoryID) params.set("categoryId", options.categoryID);
  if (options.productID) params.set("productId", options.productID);
  if (cursor) params.set("cursor", cursor);
  const value = await readJSON(baseURL, path + "?" + params, options.signal);
  if (!object(value) || value.storeId !== storeID || !Array.isArray(value.offers) ||
      !text(value.nextCursor) || value.nextCursor.length > 2048 ||
      (cursor && value.nextCursor === cursor) ||
      !value.offers.every(item => object(item) && text(item.offerId) && text(item.productId) &&
        text(item.productName) && text(item.variantId) && text(item.variantTitle) &&
        Number.isSafeInteger(item.priceMinor) && (item.priceMinor as number) > 0 &&
        item.currency === "YER" &&
        (item.baseUnit === "COUNT" || item.baseUnit === "GRAM" || item.baseUnit === "MILLILITER") &&
        (item.pricingBasis === "PER_UNIT" || item.pricingBasis === "PER_MEASURE") &&
        Number.isSafeInteger(item.pricingUnitBaseUnits) && (item.pricingUnitBaseUnits as number) > 0 &&
        ((item.pricingBasis === "PER_UNIT" && item.baseUnit === "COUNT" && item.pricingUnitBaseUnits === 1) ||
          (item.pricingBasis === "PER_MEASURE" && (item.baseUnit === "GRAM" || item.baseUnit === "MILLILITER"))) &&
        Array.isArray(item.media) &&
        item.media.every((media: unknown) => object(media) && publicMedia(media.uri) && text(media.role)) &&
        (!options.productID || item.productId === options.productID)))
    throw new IndependentStoreUnavailable("INVALID_PUBLIC_CATALOG");
  return value as IndependentPublicCatalog;
}
