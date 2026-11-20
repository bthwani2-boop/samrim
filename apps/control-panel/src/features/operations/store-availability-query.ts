/** A private Store read must never accept a caller-provided actor, role or upstream URL. */
export function parseStoreAvailabilityQuery(
  query: Record<string, string | string[] | undefined>,
): string | null {
  if (Object.keys(query).some(key => key !== "storeId")) return null;
  if (!Object.hasOwn(query, "storeId")) return "";
  const id = query.storeId;
  return typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id) ? id : null;
}
