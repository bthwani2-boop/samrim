import { validMerchantCatalogDraft } from "@bthwani/dsh";
import { type CatalogReader, collectMerchantCatalogOffers } from "./catalog-pages.ts";

// This is only a local syntax/shape preflight. Even valid rows require a DSH
// import run to resolve identities, existing offers, permissions and conflicts.
export const csvPreviewByteLimit = 8 * 1024 * 1024;
const rowLimit = 5000;

// The native File.slice implementation reads the entire file synchronously.
// Consume a bounded stream instead, and close it even on scope cancellation.
export async function readCatalogCsv(file: Pick<Blob, "size" | "stream">, signal: AbortSignal): Promise<string> {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > csvPreviewByteLimit) throw new Error("CSV_LIMIT");
  signal.throwIfAborted();
  const reader = file.stream().getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > size) throw new Error("CSV_LIMIT");
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    if (offset !== size) throw new Error("CSV_FORMAT");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("CSV_FORMAT"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    try { await reader.cancel(); } catch { /* original read failure remains authoritative */ }
    reader.releaseLock();
  }
}
type StoreNameMatch = Readonly<{ count: number; priceYer?: string; stockUnits?: number; published?: boolean }>;

type PreviewRow = Readonly<{
  row: number; name: string; priceYer: string; stockUnits: string;
  reason: "invalid" | "duplicate-name" | "owner-review" | "existing-store-name";
  match?: StoreNameMatch;
}>;

export function previewCatalogCsv(input: string): PreviewRow[] {
  if (input.length > csvPreviewByteLimit) throw new Error("CSV_LIMIT");
  if (input.includes("\u0000") || input.includes("\uFFFD")) throw new Error("CSV_FORMAT");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const pushCell = () => {
    // Keep at most one extra field to mark a malformed record; never allocate
    // an unbounded array for a row with excessive delimiters.
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
        if (text[i+1] === '"') { cell += '"'; i++; }
        else state = "closed";
      } else cell += ch;
      continue;
    }
    if (ch === ",") pushCell();
    else if (ch === "\n") pushRow();
    else if (ch === "\r") {
      if (text[++i] !== "\n") throw new Error("CSV_FORMAT");
      pushRow();
    } else if (state === "closed") throw new Error("CSV_FORMAT");
    else if (ch === '"') {
      if (cell !== "") throw new Error("CSV_FORMAT");
      state = "quoted";
    } else cell += ch;
  }
  if (state === "quoted") throw new Error("CSV_FORMAT");
  if (row.length || cell || state === "closed") pushRow();
  if (rows.length < 2 || rows[0]?.length !== 3 ||
    rows[0][0] !== "name" || rows[0][1] !== "price_yer" || rows[0][2] !== "stock_units") {
    throw new Error("CSV_HEADER");
  }
  const names = new Map<string, number>();
  for (const [name = ""] of rows.slice(1)) {
    const key = name.trim().normalize("NFC").toLowerCase();
    if (key) names.set(key, (names.get(key) ?? 0) + 1);
  }
  return rows.slice(1).map(([rawName = "", rawPrice = "", rawStock = ""], i) => {
    const name = rawName.trim(), priceYer = rawPrice.trim(), stockUnits = rawStock.trim();
    const valid = rows[i+1]?.length === 3 && /^[0-9]{1,10}$/.test(stockUnits) && validMerchantCatalogDraft({
      operationId: "preview-draft-0001", name, priceYer, stockUnits: Number(stockUnits),
    });
    const duplicate = (names.get(name.normalize("NFC").toLowerCase()) ?? 0) > 1;
    return { row: i+2, name, priceYer, stockUnits,
      reason: !valid ? "invalid" : duplicate ? "duplicate-name" : "owner-review" };
  });
}

/** Names only are observations, never canonical identity resolution or import admission. */
export async function reviewCatalogImportRows(
  rows: readonly PreviewRow[], actorId: string, storeId: string, signal: AbortSignal, read: CatalogReader,
): Promise<PreviewRow[]> {
  const offers = await collectMerchantCatalogOffers(actorId, storeId, signal, read);
  signal.throwIfAborted();
  const key = (name: string) => name.trim().normalize("NFC").toLowerCase();
  const existing = new Map<string, StoreNameMatch>();
  for (const offer of offers) {
    const name = key(offer.name);
    const previous = existing.get(name);
    existing.set(name, previous ? { count: previous.count + 1 } : {
      count: 1, priceYer: offer.priceYer, stockUnits: offer.stockUnits, published: offer.published,
    });
  }
  return rows.map(row => {
    const match = row.reason === "owner-review" ? existing.get(key(row.name)) : undefined;
    return match ? { ...row, reason: "existing-store-name", match } : row;
  });
}
