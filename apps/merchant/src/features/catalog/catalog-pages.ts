import type { MerchantCatalogOffer, MerchantCatalogPage, MerchantCatalogStatus } from "@bthwani/dsh";

export type CatalogSelectors = { query?: string; status?: MerchantCatalogStatus };
export type CatalogReader = (
  storeId: string, actorId: string, signal: AbortSignal,
  options: { limit: number; cursor?: string } & CatalogSelectors,
) => Promise<MerchantCatalogPage>;

const pageSize = 50;
const maxRows = 5000;

// Shared bounded traversal of the existing private DSH catalog. No local
// business writer or snapshot guarantee. Never return a partial result.
export async function collectMerchantCatalogOffers(
  actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
  selectors: CatalogSelectors = {},
): Promise<MerchantCatalogOffer[]> {
  const { query, status } = selectors;
  const offers: MerchantCatalogOffer[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxRows / pageSize; i++) {
    signal.throwIfAborted();
    const page = await read(storeId, actorId, signal, { limit: pageSize, ...(cursor ? { cursor } : {}),
      ...(query ? { query } : {}), ...(status ? { status } : {}) });
    signal.throwIfAborted();
    if (page.actorId !== actorId || page.storeId !== storeId || page.items.length > pageSize) {
      throw new Error("CATALOG_EXPORT_SCOPE");
    }
    let last = cursor ?? "";
    for (const item of page.items) {
      if (item.storeId !== storeId || item.id <= last) throw new Error("CATALOG_EXPORT_SCOPE");
      last = item.id;
      offers.push(item);
    }
    if (!page.nextCursor) return offers;
    if (page.items.length !== pageSize || page.nextCursor !== last || page.nextCursor === cursor) {
      throw new Error("CATALOG_EXPORT_SCOPE");
    }
    cursor = page.nextCursor;
  }
  throw new Error("CATALOG_EXPORT_LIMIT");
}
