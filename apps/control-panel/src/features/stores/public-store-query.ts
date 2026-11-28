/** Operator URL state for DSH public reads. No HTTP relay or owner authority. */
import { isPublicId } from "@bthwani/dsh";

type QueryParams = Record<string, string | string[] | undefined>;
type SearchPage = Readonly<{ query: string; cursor?: string }>;
type StoreBrowse = SearchPage & Readonly<{ city: string; vertical?: string | undefined }>;
type OfferBrowse = SearchPage & Readonly<{ storeId: string }>;
type OfferFilter = Readonly<{ offerQuery?: string | undefined }>;
type StoreDetail = StoreBrowse & OfferFilter & Readonly<{ storeId: string }>;

function admits(params: QueryParams, keys: readonly string[]): boolean {
  return params !== null && typeof params === "object" && !Array.isArray(params)
    && Reflect.ownKeys(params).every(key => typeof key === "string" && keys.includes(key))
    && keys.every(key => !(key in params) || Object.hasOwn(params, key));
}

function search(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  const points = [...value];
  if (points.length > 80 || points.some(char => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || (code >= 0xD800 && code <= 0xDFFF);
  })) return null;
  // Match the owner's Unicode whitespace normalization, not JS trim (BOM differs).
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

function page(query: unknown, cursor: unknown): SearchPage | null {
  const text = search(query);
  if (text === null || (cursor !== undefined &&
      (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)))) return null;
  return { query: text, ...(typeof cursor === "string" ? { cursor } : {}) };
}

export function parsePublicStoreBrowse(params: QueryParams): StoreBrowse | null {
  if (!admits(params, ["city", "q", "vertical", "cursor"])) return null;
  const { city, q, cursor } = params;
  const vertical = params.vertical === "" ? undefined : params.vertical;
  if (city === undefined && q === undefined && cursor === undefined && vertical === undefined) {
    return { city: "", query: "" };
  }
  const scope = page(q, cursor);
  if (!isPublicId(city) || !scope || (vertical !== undefined && !isPublicId(vertical))) return null;
  return { city, ...scope, ...(vertical === undefined ? {} : { vertical }) };
}

export function parsePublishedOfferQuery(params: QueryParams): OfferBrowse | null {
  if (!admits(params, ["store", "q", "cursor"])) return null;
  const { store, q, cursor } = params;
  if (store === undefined && q === undefined && cursor === undefined) return { storeId: "", query: "" };
  const scope = page(q, cursor);
  return isPublicId(store) && scope ? { storeId: store, ...scope } : null;
}

export function parsePublicStoreDetail(storeId: string, params: QueryParams): StoreDetail | null {
  if (!isPublicId(storeId) || !admits(params, ["city", "q", "vertical", "cursor", "offerQ"])) return null;
  const { offerQ, ...directory } = params;
  const scope = parsePublicStoreBrowse(directory);
  const offerQuery = search(offerQ);
  return scope?.city && offerQuery !== null
    ? { storeId, ...scope, ...(offerQuery ? { offerQuery } : {}) } : null;
}

function queryParams(scope: SearchPage, key: "city" | "store", id: string): URLSearchParams {
  const result = new URLSearchParams({ [key]: id });
  if (scope.query) result.set("q", scope.query);
  return result;
}

function directoryParams(scope: StoreBrowse): URLSearchParams {
  const result = queryParams(scope, "city", scope.city);
  if (scope.vertical) result.set("vertical", scope.vertical);
  if (scope.cursor) result.set("cursor", scope.cursor);
  return result;
}

export function publicStorePageHref(scope: StoreBrowse): string {
  return "/merchants/public-stores?" + directoryParams(scope).toString();
}

export function publicStoreDetailHref(storeId: string, scope: StoreBrowse & OfferFilter): string {
  const params = directoryParams(scope);
  if (scope.offerQuery) params.set("offerQ", scope.offerQuery);
  return "/merchants/public-stores/" + encodeURIComponent(storeId) + "?" + params.toString();
}

export function publishedOfferHref(scope: OfferBrowse, pathname: "/catalog" | "/catalog/products" = "/catalog"): string {
  const params = queryParams(scope, "store", scope.storeId);
  if (scope.cursor) params.set("cursor", scope.cursor);
  return pathname + "?" + params.toString();
}

/** Existing isolated Operator trust boundary: only an explicit canonical loopback HTTP origin. */
export function isolatedPublicDshOrigin(raw: string | undefined): string | null {
  if (typeof raw !== "string" || !raw.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.port && !url.username && !url.password && url.pathname === "/"
      && !url.search && !url.hash && raw === url.origin ? raw : null;
  } catch {
    return null;
  }
}
