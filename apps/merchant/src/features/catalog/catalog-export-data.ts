import { validMerchantCatalogDraftEdit } from "@bthwani/dsh";
import { catalogImportNameKey, isCatalogImportDraft } from "./catalog-import-data.ts";
import { type CatalogReader, type CatalogSelectors, collectMerchantCatalogOffers } from "./catalog-pages.ts";

// Treat spreadsheet formula prefixes as text; quoting alone does not prevent
// formula execution. Keep the underlying decimal amount unrounded in the CSV.
function formulaLike(text: string): boolean {
  return /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/u.test(text);
}

function cell(value: string | number | boolean): string {
  let text = String(value);
  if (formulaLike(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function collectCatalogExport(
  actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
  selectors: CatalogSelectors = {},
  format: "report" | "draft-edit" = "report",
): Promise<{ csv: string; count: number; excluded?: number }> {
  const offers = await collectMerchantCatalogOffers(actorId, storeId, signal, read, format === "draft-edit" ? {} : selectors);
  signal.throwIfAborted();
  if (format === "draft-edit") {
    // Compare against every Store offer, even published ones. The CSV is a
    // review input, not an identity token or authorization to update a draft.
    const names = new Map<string, number>();
    for (const offer of offers) {
      const key = catalogImportNameKey(offer.name);
      names.set(key, (names.get(key) ?? 0) + 1);
    }
    const drafts = offers.filter(offer => isCatalogImportDraft(offer) &&
      names.get(catalogImportNameKey(offer.name)) === 1 && offer.name === offer.name.trim() &&
      !formulaLike(offer.name) && !offer.name.includes("\uFFFD") &&
      validMerchantCatalogDraftEdit({ operationId: "draft-export-0001", name: offer.name,
        priceYer: offer.priceYer, stockUnits: offer.stockUnits, expectedVersion: offer.draftVersion }));
    if (drafts.length === 0) throw new Error("CATALOG_IMPORT_TEMPLATE_EMPTY");
    const rows = ["name,price_yer,stock_units", ...drafts.map(offer => [offer.name, offer.priceYer, offer.stockUnits].map(cell).join(","))];
    return { csv: "\uFEFF" + rows.join("\r\n") + "\r\n", count: drafts.length, excluded: offers.length - drafts.length };
  }
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
