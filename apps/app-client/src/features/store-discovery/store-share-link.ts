// A shared Store link keeps its publicly selected Service City for first-time visitors.
// The DSH service still validates city activity and Store publication on every read.
export function buildStoreSharePath(storeId: string, serviceCityId: string, productId = ""): string {
  const query = [
    serviceCityId ? `serviceCityId=${encodeURIComponent(serviceCityId)}` : "",
    productId ? `productId=${encodeURIComponent(productId)}` : "",
  ].filter(Boolean).join("&");
  return `store/${encodeURIComponent(storeId)}${query ? `?${query}` : ""}`;
}
