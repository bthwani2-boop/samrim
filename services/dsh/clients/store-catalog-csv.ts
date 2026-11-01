import type { CatalogStoreOffer } from "./generated/dsh-types";

// Read the canonical DSH Store offer cursor, never a view's currently loaded rows.
export const STORE_CATALOG_EXPORT_PAGE_SIZE = 50;
export const STORE_CATALOG_EXPORT_MAX_ROWS = 25_000;

type OfferPage = Readonly<{ offers: ReadonlyArray<CatalogStoreOffer>; nextCursor?: string }>;
type ReadOfferPage = (cursor: string) => Promise<OfferPage>;

function csvCell(value: string | number): string {
  let text = String(value).replace(/[\r\n\t]+/g, " ");
  // Treat untrusted Store/Product text as text, never as an Excel formula.
  if (typeof value === "string" && /^[\s\u200B-\u200D\u2060\uFEFF]*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function buildStoreCatalogCsv(offers: ReadonlyArray<CatalogStoreOffer>): string {
  const rows: ReadonlyArray<ReadonlyArray<string | number>> = [
    ["اسم المنتج", "النسخة", "العلامة التجارية", "السعر بالريال", "التوافر", "حالة النشر", "هوية القياس", "الوحدة الأساسية"],
    ...offers.map(offer => [
      offer.productName,
      offer.variantTitle,
      offer.brand ?? "",
      offer.priceMinor,
      offer.availability ? "متاح" : "غير متاح",
      offer.publicationState === "published" ? "منشور" : offer.publicationState === "hidden" ? "مخفي" : "مسودة",
      offer.measurementKind === "DISCRETE" ? "عدد" : offer.measurementKind === "MEASURED" ? "قياس" : "كمية متغيرة",
      offer.baseUnit,
    ]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

export async function collectStoreCatalogCsv(
  storeId: string,
  readPage: ReadOfferPage,
  onProgress?: (count: number) => void,
): Promise<Readonly<{ csv: string; count: number }>> {
  if (!storeId.trim()) throw new Error("STORE_EXPORT_INVALID_SCOPE");
  const items: CatalogStoreOffer[] = [];
  const seenOffers = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = "";
  for (;;) {
    if (seenCursors.has(cursor)) throw new Error("STORE_EXPORT_CURSOR_REPEATED");
    seenCursors.add(cursor);
    const page = await readPage(cursor);
    if (!page || !Array.isArray(page.offers) || typeof page.nextCursor !== "string" && page.nextCursor !== undefined || page.offers.length > STORE_CATALOG_EXPORT_PAGE_SIZE) {
      throw new Error("STORE_EXPORT_INVALID_RESPONSE");
    }
    for (const item of page.offers) {
      if (!item || item.storeId !== storeId || !item.offerId || seenOffers.has(item.offerId)) throw new Error("STORE_EXPORT_SCOPE_OR_DUPLICATE");
      seenOffers.add(item.offerId);
      items.push(item);
    }
    onProgress?.(items.length);
    const next = page.nextCursor ?? "";
    if (!next) break;
    if (!page.offers.length || items.length >= STORE_CATALOG_EXPORT_MAX_ROWS) throw new Error("STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT");
    cursor = next;
  }
  if (items.length > STORE_CATALOG_EXPORT_MAX_ROWS) throw new Error("STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT");
  return { csv: buildStoreCatalogCsv(items), count: items.length };
}
