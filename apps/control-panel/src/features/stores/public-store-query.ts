/** Operator presentation queries for the DSH public directory and Offer projection. */
type QueryParams = Record<string, string | string[] | undefined>;
type PublicSearchPage = Readonly<{ query: string; cursor?: string }>;

export type PublicStoreBrowse = PublicSearchPage & Readonly<{
  city: string; vertical?: string | undefined;
}>;
export type PublishedOfferQuery = PublicSearchPage & Readonly<{ storeId: string }>;
type OfferSearch = Readonly<{ offerQuery?: string | undefined }>;
export type PublicStoreDetailBrowse = PublicStoreBrowse & OfferSearch & Readonly<{ storeId: string }>;

function admittedParams(params: QueryParams, keys: readonly string[]): boolean {
  return !!params && typeof params === "object" && !Array.isArray(params) &&
    Object.keys(params).every(key => keys.includes(key)) &&
    keys.every(key => !(key in params) || Object.hasOwn(params, key));
}
function publicId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}
function publicCursor(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
}
function parseSearch(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  const points = [...value];
  if (points.length > 80 || points.some(char => {
    const point = char.codePointAt(0) ?? 0;
    return point < 32 || point === 127 || (point >= 0xD800 && point <= 0xDFFF);
  })) return null;
  // DSH's Go publicSearch hashes strings.TrimSpace(raw), not JS trim().
  // Preserve BOM and normalize only the owner's Unicode White_Space set.
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
function parsePage(q: unknown, cursor: unknown): PublicSearchPage | null {
  const query = parseSearch(q);
  if (query === null || (cursor !== undefined && !publicCursor(cursor))) return null;
  return { query, ...(cursor === undefined ? {} : { cursor }) };
}

// No implicit City or Store: without a selected scope, no owner read.
export function parsePublicStoreBrowse(params: QueryParams): PublicStoreBrowse | null {
  if (!admittedParams(params, ["city", "q", "vertical", "cursor"])) return null;
  const { city, q, vertical: requestedVertical, cursor } = params;
  const vertical = requestedVertical === "" ? undefined : requestedVertical;
  if (city === undefined && q === undefined && vertical === undefined && cursor === undefined) {
    return { city: "", query: "" };
  }
  const page = parsePage(q, cursor);
  if (!publicId(city) || !page || (vertical !== undefined && !publicId(vertical))) return null;
  return { city, ...page, ...(vertical === undefined ? {} : { vertical }) };
}

export function parsePublishedOfferQuery(params: QueryParams): PublishedOfferQuery | null {
  if (!admittedParams(params, ["store", "q", "cursor"])) return null;
  const { store, q, cursor } = params;
  if (store === undefined && q === undefined && cursor === undefined) return { storeId: "", query: "" };
  const page = parsePage(q, cursor);
  return publicId(store) && page ? { storeId: store, ...page } : null;
}

export function parsePublicStoreDetail(storeId: string, params: QueryParams): PublicStoreDetailBrowse | null {
  if (!publicId(storeId) || !admittedParams(params, ["city", "q", "vertical", "cursor", "offerQ"])) return null;
  const { offerQ, ...directoryParams } = params;
  const browse = parsePublicStoreBrowse(directoryParams);
  const offerQuery = parseSearch(offerQ);
  if (!browse?.city || offerQuery === null) return null;
  return { storeId, ...browse, ...(offerQuery ? { offerQuery } : {}) };
}

function searchParams(scope: PublicSearchPage, scopeKey: "city" | "store", scopeId: string): URLSearchParams {
  const params = new URLSearchParams({ [scopeKey]: scopeId });
  if (scope.query) params.set("q", scope.query);
  return params;
}
function browseParams(scope: PublicStoreBrowse): URLSearchParams {
  const params = searchParams(scope, "city", scope.city);
  if (scope.vertical) params.set("vertical", scope.vertical);
  if (scope.cursor) params.set("cursor", scope.cursor);
  return params;
}
export function publicStorePageHref(scope: PublicStoreBrowse): string {
  return "/merchants/public-stores?" + browseParams(scope).toString();
}
export function publicStoreDetailHref(storeId: string, scope: PublicStoreBrowse & OfferSearch): string {
  const params = browseParams(scope);
  if (scope.offerQuery) params.set("offerQ", scope.offerQuery);
  return "/merchants/public-stores/" + encodeURIComponent(storeId) + "?" + params.toString();
}
export function publishedOfferHref(scope: PublishedOfferQuery, pathname: "/catalog" | "/catalog/products" = "/catalog"): string {
  const params = searchParams(scope, "store", scope.storeId);
  if (scope.cursor) params.set("cursor", scope.cursor);
  return pathname + "?" + params.toString();
}

// Reuse the existing isolated DSH owner configured for the Operator BFF.
// Never accept a caller-supplied upstream URL, non-loopback host or credentials.
export function isolatedPublicDshOrigin(raw: string | undefined): string | null {
  if (!raw?.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.port ||
        url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash || url.origin !== raw) return null;
    return raw;
  } catch {
    return null;
  }
}
export function resolvePublicDshOrigin(configured: string | undefined, runtime: string | undefined): string | null {
  // The fixed local port is a development-only fallback. Production must supply
  // an explicit, validated owner origin through the existing Operator configuration.
  return isolatedPublicDshOrigin(configured ??
    (runtime === "development" ? "http://127.0.0.1:3202" : undefined));
}
