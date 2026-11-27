/** A city scope is not evidence that delivery or checkout is available. */
export function normalizeServiceCityId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized) ? normalized : "";
}

/** Store route identifiers follow DSH's PublicId contract; never coerce an alias. */
export function readPublicStoreId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value) ? value : null;
}

const STORE_SEARCH_LIMIT = 80;
export const INVALID_PUBLIC_SEARCH_MESSAGE = "عبارة البحث غير صالحة. استخدم ٨٠ حرفًا أو أقل دون محارف غير صالحة.";

// Go strings.TrimSpace uses Unicode White_Space: NEL is included, BOM is not.
// Numeric scalar classification also avoids renderer-specific regex support.
function isOwnerWhitespace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x85 ||
    code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

export function readPublicSearch(value: unknown): string | null {
  if (typeof value !== "string" || value.length > STORE_SEARCH_LIMIT * 2) return null;
  let offset = 0;
  let count = 0;
  let start = -1;
  let end = 0;
  for (const scalar of value) {
    const code = scalar.charCodeAt(0);
    if (++count > STORE_SEARCH_LIMIT || code === 0 ||
      (scalar.length === 1 && code >= 0xd800 && code <= 0xdfff)) return null;
    if (!isOwnerWhitespace(code)) {
      if (start === -1) start = offset;
      end = offset + scalar.length;
    }
    offset += scalar.length;
  }
  return start === -1 ? "" : value.slice(start, end);
}

/** Keep one excess scalar visible so an oversized paste is rejected, not submitted as a different query. */
export function capturePublicSearchDraft(value: string): string {
  let end = 0;
  let count = 0;
  for (const scalar of value) {
    end += scalar.length;
    if (++count > STORE_SEARCH_LIMIT) break;
  }
  return value.slice(0, end);
}

type BrowseParams = { city?: string | string[]; q?: string | string[]; vertical?: string | string[] };

export function readStoreBrowseScope(params: BrowseParams, defaultCity: string) {
  const city = typeof params.city === "string" ? normalizeServiceCityId(params.city) : "";
  const vertical = typeof params.vertical === "string" ? normalizeServiceCityId(params.vertical) : "";
  return {
    city: city || defaultCity,
    ...(vertical ? { vertical } : {}),
    q: readPublicSearch(params.q) ?? "",
  };
}

const cityLabels: Readonly<Record<string, string>> = { sanaa: "صنعاء", aden: "عدن" };

export function serviceCityLabel(city: string) {
  return Object.hasOwn(cityLabels, city) ? cityLabels[city] : city;
}
