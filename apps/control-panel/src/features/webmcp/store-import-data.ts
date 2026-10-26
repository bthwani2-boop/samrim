export type StoreImportInputRow = Readonly<{
  name?: string;
  barcode?: string;
  priceYER: number;
  unit?: "COUNT" | "GRAM" | "MILLILITER";
  variant?: string;
}>;

export const MAX_STORE_IMPORT_ROWS = 5000;
export const MAX_STORE_IMPORT_BYTES = 20 * 1024 * 1024;

function csvCell(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

export function buildStoreImportCsv(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_STORE_IMPORT_ROWS) {
    throw new Error("Provide 1–5000 product rows.");
  }
  const lines = ["barcode,name,price,unit,variant"];
  for (const [index, raw] of rows.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Row " + (index + 1) + " must be an object.");
    }
    const row = raw as Partial<StoreImportInputRow>;
    if ((row.name !== undefined && typeof row.name !== "string") ||
        (row.barcode !== undefined && typeof row.barcode !== "string") ||
        (row.variant !== undefined && typeof row.variant !== "string")) {
      throw new Error("Row " + (index + 1) + " has invalid text fields.");
    }
    const name = row.name?.trim() ?? "";
    const barcode = row.barcode?.trim() ?? "";
    const variant = row.variant?.trim() ?? "";
    if ((!barcode && (name.length < 2 || name.length > 160)) ||
        name.length > 160 || barcode.length > 128 || variant.length > 160 ||
        (!name && !barcode)) {
      throw new Error("Row " + (index + 1) + " requires a valid name or barcode.");
    }
    if (!Number.isSafeInteger(row.priceYER) || (row.priceYER ?? 0) <= 0) {
      throw new Error("Row " + (index + 1) + " needs a positive whole-YER price.");
    }
    if (row.unit !== undefined && !["COUNT", "GRAM", "MILLILITER"].includes(row.unit)) {
      throw new Error("Row " + (index + 1) + " has an unsupported unit.");
    }
    lines.push([barcode, name, String(row.priceYER), row.unit ?? "COUNT", variant].map(csvCell).join(","));
  }
  const csv = lines.join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).byteLength > MAX_STORE_IMPORT_BYTES) {
    throw new Error("Import exceeds 20 MiB.");
  }
  return csv;
}

type ImportItem = Readonly<{ rowNumber?: number; classification?: string; errorMessage?: string }>;
type ImportResponse = Readonly<{
  run: { id: string; state: string; acceptedCount: number; conflictCount: number };
  items?: ImportItem[];
}>;

export function summarizeStoreImport(value: ImportResponse) {
  const counts: Record<string, number> = {};
  for (const item of value.items ?? []) {
    const kind = item.classification ?? "UNKNOWN";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return {
    runId: value.run.id,
    state: value.run.state,
    acceptedCount: value.run.acceptedCount,
    conflictCount: value.run.conflictCount,
    classifications: counts,
    issues: (value.items ?? []).filter(item => item.errorMessage).slice(0, 15)
      .map(item => ({ row: item.rowNumber, classification: item.classification, reason: item.errorMessage })),
    reviewUrl: "/catalog/import",
  };
}
