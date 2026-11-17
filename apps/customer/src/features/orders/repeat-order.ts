/** Revisits the Store; never silently creates a replacement Order. */
export function repeatOrderStoreDestination(storeId: string): string | null {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(storeId)) return null;
  return `/store/${encodeURIComponent(storeId)}`;
}
