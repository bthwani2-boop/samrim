/** A city scope is not evidence that delivery or checkout is available. */
export function normalizeServiceCityId(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized) ? normalized : "";
}
