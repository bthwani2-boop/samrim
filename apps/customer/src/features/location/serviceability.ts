/** A city scope is not evidence that delivery or checkout is available. */
export function normalizeServiceCityId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized) ? normalized : "";
}

export const STORE_SEARCH_LIMIT = 80;

type BrowseParams = { city?: string | string[]; q?: string | string[] };

export function readStoreBrowseScope(params: BrowseParams, defaultCity: string) {
  const city = typeof params.city === "string" ? normalizeServiceCityId(params.city) : "";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  return {
    city: city || defaultCity,
    q: Array.from(q).length <= STORE_SEARCH_LIMIT && !q.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(q) ? q : "",
  };
}

const cityLabels: Readonly<Record<string, string>> = { sanaa: "صنعاء", aden: "عدن" };

export function serviceCityLabel(city: string) {
  return Object.hasOwn(cityLabels, city) ? cityLabels[city] : city;
}
