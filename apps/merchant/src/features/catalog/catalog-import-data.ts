import { type MerchantCatalogImportChange, type MerchantCatalogOffer, validMerchantCatalogDraft } from "@bthwani/dsh";
import { type CatalogReader, collectMerchantCatalogOffers } from "./catalog-pages.ts";

// Local CSV preflight is not DSH import admission or identity resolution.
export const csvPreviewByteLimit = 8 * 1024 * 1024;
const rowLimit = 5000;

export async function readCatalogCsv(
  file: Pick<Blob, "size" | "stream">,
  signal: AbortSignal,
): Promise<{ source: string; bytes: Uint8Array<ArrayBuffer> }> {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > csvPreviewByteLimit) {
    throw new Error("CSV_LIMIT");
  }
  signal.throwIfAborted();
  // Native File.slice reads the complete file synchronously; use one bounded
  // stream instead. The caller owns the review deadline.
  const reader = file.stream().getReader();
  let completed = false;
  let cancellationStarted = false;
  const cancel = () => {
    if (completed || cancellationStarted) return;
    cancellationStarted = true;
    // Cleanup must not hold the review hostage to an uncooperative source.
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        completed = true;
        break;
      }
      if (chunk.value.byteLength > size - offset) throw new Error("CSV_LIMIT");
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    if (offset !== size) throw new Error("CSV_FORMAT");
    try {
      return { source: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes };
    } catch {
      throw new Error("CSV_FORMAT");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

type StoreNameMatch = Readonly<{ count: number; priceYer?: string; stockUnits?: number; published?: boolean }>;
type PreviewRow = Readonly<{
  row: number; name: string; priceYer: string; stockUnits: string;
  reason: "invalid" | "duplicate-name" | "owner-review" | "existing-store-name";
  match?: StoreNameMatch;
  editableDraft?: MerchantCatalogOffer;
}>;

export function catalogImportNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

export function previewCatalogCsv(input: string): PreviewRow[] {
  if (input.length > csvPreviewByteLimit) throw new Error("CSV_LIMIT");
  if (input.includes("\u0000") || input.includes("\uFFFD")) throw new Error("CSV_FORMAT");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const pushCell = () => {
    // Retain only one extra field as evidence of a malformed record.
    if (row.length < 4) row.push(cell);
    cell = "";
    state = "plain";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    if (rows.length > rowLimit + 1) throw new Error("CSV_LIMIT");
    row = [];
  };

  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === "quoted") {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          state = "closed";
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[++i] !== "\n") throw new Error("CSV_FORMAT");
      pushRow();
    } else if (state === "closed") {
      throw new Error("CSV_FORMAT");
    } else if (ch === '"') {
      if (cell !== "") throw new Error("CSV_FORMAT");
      state = "quoted";
    } else {
      cell += ch;
    }
  }
  if (state === "quoted") throw new Error("CSV_FORMAT");
  if (row.length || cell || state === "closed") pushRow();
  if (rows.length < 2 || rows[0]?.length !== 3 ||
      rows[0][0] !== "name" || rows[0][1] !== "price_yer" || rows[0][2] !== "stock_units") {
    throw new Error("CSV_HEADER");
  }

  const names = new Map<string, number>();
  const records = rows.slice(1);
  for (const [name = ""] of records) {
    const key = catalogImportNameKey(name);
    if (key) names.set(key, (names.get(key) ?? 0) + 1);
  }
  return records.map(([rawName = "", rawPrice = "", rawStock = ""], i) => {
    const name = rawName.trim();
    const priceYer = rawPrice.trim();
    const stockUnits = rawStock.trim();
    const valid = records[i]?.length === 3 && /^[0-9]{1,10}$/.test(stockUnits) &&
      validMerchantCatalogDraft({
        operationId: "preview-draft-0001", name, priceYer, stockUnits: Number(stockUnits),
      });
    const duplicate = (names.get(catalogImportNameKey(name)) ?? 0) > 1;
    return { row: i + 2, name, priceYer, stockUnits,
      reason: !valid ? "invalid" : duplicate ? "duplicate-name" : "owner-review" };
  });
}

export function isCatalogImportDraft(offer: MerchantCatalogOffer): boolean {
  return offer.published === false && offer.available === false && offer.productActive === false &&
    offer.variantSellable === false && offer.requiredAttributesValid === false &&
    Number.isSafeInteger(offer.draftVersion) && offer.draftVersion >= 1 &&
    offer.draftVersion < Number.MAX_SAFE_INTEGER;
}

/** Names are observations, never canonical identity resolution or admission. */
export async function reviewCatalogImportRows(
  rows: readonly PreviewRow[], actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
): Promise<PreviewRow[]> {
  const offers = await collectMerchantCatalogOffers(actorId, storeId, signal, read);
  signal.throwIfAborted();
  const existing = new Map<string, StoreNameMatch & { draft?: MerchantCatalogOffer }>();
  for (const offer of offers) {
    const name = catalogImportNameKey(offer.name);
    const previous = existing.get(name);
    existing.set(name, previous ? { count: previous.count + 1 } : {
      count: 1, priceYer: offer.priceYer, stockUnits: offer.stockUnits, published: offer.published,
      ...(isCatalogImportDraft(offer) ? { draft: offer } : {}),
    });
  }
  return rows.map(row => {
    const match = row.reason === "owner-review" ? existing.get(catalogImportNameKey(row.name)) : undefined;
    if (!match) return row;
    const { draft, ...observation } = match;
    return { ...row, reason: "existing-store-name", match: observation,
      ...(draft ? { editableDraft: draft } : {}) };
  });
}

export function buildImportManifest(
  rows: readonly PreviewRow[], sourceSha256: string, selected: ReadonlySet<number>,
): MerchantCatalogImportChange {
  return {
    sourceSha256,
    rows: rows.map(row => {
      if (row.reason === "invalid") {
        // The original file is identified by its byte digest. Invalid rows
        // retain bounded diagnostics but cannot acquire an edit target.
        const field = (value: string, max: number) => {
          const characters = [...value];
          return characters.length <= max && !characters.some(c => {
            const code = c.codePointAt(0) ?? 0;
            return code < 32 || code === 127;
          }) ? value : "";
        };
        return { row: row.row, name: field(row.name, 160), priceYer: field(row.priceYer, 19),
          stockUnits: field(row.stockUnits, 10), sourceIssue: "INVALID_ROW" };
      }
      const draft = row.editableDraft;
      return { row: row.row, name: row.name, priceYer: row.priceYer, stockUnits: row.stockUnits,
        ...(draft && selected.has(row.row) ? { offerId: draft.id, expectedVersion: draft.draftVersion } : {}) };
    }),
  };
}
