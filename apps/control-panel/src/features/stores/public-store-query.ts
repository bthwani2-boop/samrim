export type PublicStoreBrowse = Readonly<{
  city: string;
  query: string;
  cursor?: string;
}>;

const publicId = /^[a-z0-9-]{1,64}$/;
const publicCursor = /^[A-Za-z0-9_-]{1,512}$/;

// A city is selected explicitly; absent city means "no owner read", never a default city.
export function parsePublicStoreBrowse(
  params: Record<string, string | string[] | undefined>,
): PublicStoreBrowse | null {
  if (Object.keys(params).some(key => !["city", "q", "cursor"].includes(key))) return null;
  const { city, q, cursor } = params;
  if ([city, q, cursor].some(value => Array.isArray(value))) return null;
  if (city === undefined && q === undefined && cursor === undefined) {
    return { city: "", query: "" };
  }
  if (typeof city !== "string" || !publicId.test(city)) return null;
  const query = typeof q === "string" ? q.trim() : "";
  if (q !== undefined && (typeof q !== "string" ||
      [...q].length > 80 || [...q].some(char => {
        const point = char.codePointAt(0) ?? 0;
        return point < 32 || point === 127 || (point >= 0xD800 && point <= 0xDFFF);
      }))) return null;
  if (cursor !== undefined && (typeof cursor !== "string" || !publicCursor.test(cursor))) return null;
  return { city, query, ...(typeof cursor === "string" ? { cursor } : {}) };
}

export function publicStorePageHref(scope: PublicStoreBrowse): string {
  const params = new URLSearchParams({ city: scope.city });
  if (scope.query) params.set("q", scope.query);
  if (scope.cursor) params.set("cursor", scope.cursor);
  return `/merchants/public-stores?${params.toString()}`;
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

export type PublicStoreDetailBrowse = PublicStoreBrowse & Readonly<{ storeId: string }>;

export function parsePublicStoreDetail(
  storeId: string,
  params: Record<string, string | string[] | undefined>,
): PublicStoreDetailBrowse | null {
  const browse = parsePublicStoreBrowse(params);
  return publicId.test(storeId) && browse?.city ? { storeId, ...browse } : null;
}

export function publicStoreDetailHref(storeId: string, scope: PublicStoreBrowse): string {
  const suffix = publicStorePageHref(scope).slice("/merchants/public-stores".length);
  return `/merchants/public-stores/${encodeURIComponent(storeId)}${suffix}`;
}

export function resolvePublicDshOrigin(configured: string | undefined, runtime: string | undefined): string | null {
  // The fixed local port is a development-only fallback. Production must supply
  // an explicit, validated owner origin through the existing Operator configuration.
  return isolatedPublicDshOrigin(configured ??
    (runtime === "development" ? "http://127.0.0.1:3202" : undefined));
}
