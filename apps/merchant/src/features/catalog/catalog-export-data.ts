import type { MerchantCatalogPage } from "@bthwani/dsh";

type CatalogReader = (
  storeId: string, actorId: string, signal: AbortSignal,
  options: { limit: number; cursor?: string },
) => Promise<MerchantCatalogPage>;

const pageSize = 50;
const maxRows = 5000;

// Treat spreadsheet formula prefixes as text; quoting alone does not prevent
// formula execution. Keep the underlying decimal amount unrounded in the CSV.
function cell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function collectCatalogExport(
  actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
): Promise<{ csv: string; count: number }> {
  const rows = ["offer_id,store_id,product_id,variant_id,name,price_yer,stock_units,draft_version,product_active,variant_sellable,required_attributes_valid,published,available"];
  let cursor: string | undefined;
  let count = 0;
  for (let i = 0; i < maxRows / pageSize; i++) {
    signal.throwIfAborted();
    const page = await read(storeId, actorId, signal, { limit: pageSize, ...(cursor ? { cursor } : {}) });
    signal.throwIfAborted();
    if (page.actorId !== actorId || page.storeId !== storeId || page.items.length > pageSize) {
      throw new Error("CATALOG_EXPORT_SCOPE");
    }
    let last = cursor ?? "";
    for (const item of page.items) {
      if (item.storeId !== storeId || item.id <= last) throw new Error("CATALOG_EXPORT_SCOPE");
      last = item.id;
      rows.push([
        item.id, item.storeId, item.productId, item.variantId, item.name, item.priceYer,
        item.stockUnits, item.draftVersion, item.productActive, item.variantSellable,
        item.requiredAttributesValid, item.published, item.available,
      ].map(cell).join(","));
      count++;
    }
    if (!page.nextCursor) return { csv: "\uFEFF" + rows.join("\r\n") + "\r\n", count };
    if (page.items.length !== pageSize || page.nextCursor !== last || page.nextCursor === cursor) {
      throw new Error("CATALOG_EXPORT_SCOPE");
    }
    cursor = page.nextCursor;
  }
  throw new Error("CATALOG_EXPORT_LIMIT");
}
