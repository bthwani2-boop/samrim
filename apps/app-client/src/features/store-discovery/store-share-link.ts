// A shared Store link keeps its publicly selected Service City for first-time visitors.
// The DSH service still validates city activity and Store publication on every read.
export function buildStoreSharePath(storeId: string, serviceCityId: string, productId = ""): string {
  const query = [
    serviceCityId ? `serviceCityId=${encodeURIComponent(serviceCityId)}` : "",
    productId ? `productId=${encodeURIComponent(productId)}` : "",
  ].filter(Boolean).join("&");
  return `store/${encodeURIComponent(storeId)}${query ? `?${query}` : ""}`;
}

/** Use an explicitly configured HTTPS customer origin for outside-app sharing. */
export function buildPublicStoreShareURL(
  storeId: string,
  serviceCityId: string,
  publicOrigin: string | undefined,
  productId = "",
): string | null {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(storeId) || !/^[A-Za-z0-9_-]{1,150}$/.test(serviceCityId)) return null;
  if (!publicOrigin?.trim()) return null;
  try {
    const origin = new URL(publicOrigin.trim());
    if (origin.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return null;
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return null;
    return new URL(buildStoreSharePath(storeId, serviceCityId, productId), origin).toString();
  } catch { return null; }
}
