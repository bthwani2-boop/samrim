import { type CatalogReader, type CatalogSelectors, collectMerchantCatalogOffers } from "./catalog-pages.ts";

// Treat spreadsheet formula prefixes as text; quoting alone does not prevent
// formula execution. Keep the underlying decimal amount unrounded in the CSV.
function cell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function collectCatalogExport(
  actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
  selectors: CatalogSelectors = {},
): Promise<{ csv: string; count: number }> {
  const offers = await collectMerchantCatalogOffers(actorId, storeId, signal, read, selectors);
  signal.throwIfAborted();
  const rows = ["offer_id,store_id,product_id,variant_id,name,price_yer,stock_units,draft_version,product_active,variant_sellable,required_attributes_valid,published,available"];
  for (const item of offers) {
    rows.push([
      item.id, item.storeId, item.productId, item.variantId, item.name, item.priceYer,
      item.stockUnits, item.draftVersion, item.productActive, item.variantSellable,
      item.requiredAttributesValid, item.published, item.available,
    ].map(cell).join(","));
  }
  return { csv: "\uFEFF" + rows.join("\r\n") + "\r\n", count: offers.length };
}
