import { DshPublicError } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type MerchantCatalogImportRow = Readonly<{ row: number; name: string; priceYer: string; stockUnits: string; offerId?: string; expectedVersion?: number; sourceIssue?: "INVALID_ROW" }>;
export type MerchantCatalogImportChange = Readonly<{ sourceSha256: string; rows: readonly MerchantCatalogImportRow[] }>;
export type MerchantCatalogImportOutcome = Readonly<{ row: number; status: "ACCEPTED" | "HELD" | "FAILED"; reason: string; offerId?: string; resultVersion?: number }>;
export type MerchantCatalogImportResult = Readonly<{ actorId: string; storeId: string; runId: string; sourceSha256: string; total: number; processed: number; offset: number; outcomes: MerchantCatalogImportOutcome[] }>;
type ImportMethod = "GET" | "PUT" | "PATCH";

const id = /^[a-z0-9-]{1,64}$/;
const run = /^[A-Za-z0-9._-]{8,128}$/;
const digest = /^[a-f0-9]{64}$/;
const maxRows = 5000;
const pageSize = 25;
const byteLimit = 8 * 1024 * 1024;
const heldReasons = new Set(["UNSELECTED", "DUPLICATE", "INVALID_VALUES", "AMBIGUOUS_OR_CHANGED", "INELIGIBLE", "STALE_VERSION_OR_NAME"]);
const encoder = new TextEncoder();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && !value.includes(String.fromCharCode(0)) &&
    !/[\uD800-\uDFFF]/u.test(value) && encoder.encode(value).length <= max;
}
function dense(value: unknown, min: number, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max || Object.keys(value).length !== value.length) return false;
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) return false;
  return true;
}

function rowFrom(raw: unknown, index: number): MerchantCatalogImportRow | undefined {
  if (!record(raw)) return undefined;
  const { row, name, priceYer, stockUnits, offerId, expectedVersion, sourceIssue } = raw;
  if (row !== index + 2 || !boundedText(name, 4096) || !boundedText(priceYer, 128) || !boundedText(stockUnits, 128)) return undefined;
  const base = { row, name, priceYer, stockUnits };
  const keys = ["row", "name", "priceYer", "stockUnits"];
  if (sourceIssue !== undefined) {
    return sourceIssue === "INVALID_ROW" && exact(raw, [...keys, "sourceIssue"]) ? Object.freeze({ ...base, sourceIssue }) : undefined;
  }
  if (offerId !== undefined) {
    return typeof offerId === "string" && id.test(offerId) && integer(expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) &&
      exact(raw, [...keys, "offerId", "expectedVersion"]) ? Object.freeze({ ...base, offerId, expectedVersion }) : undefined;
  }
  return exact(raw, keys) ? Object.freeze(base) : undefined;
}

// One detached manifest binds validation, actual JSON and acknowledgement.
// The owner, not this client, resolves identity and admits individual rows.
function manifestFrom(value: unknown): MerchantCatalogImportChange | undefined {
  if (!record(value) || !exact(value, ["sourceSha256", "rows"])) return undefined;
  const { sourceSha256, rows } = value;
  if (typeof sourceSha256 !== "string" || !digest.test(sourceSha256) || !dense(rows, 1, maxRows)) return undefined;
  const captured: MerchantCatalogImportRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rowFrom(rows[i], i);
    if (!row) return undefined;
    captured.push(row);
  }
  const result = Object.freeze({ sourceSha256, rows: Object.freeze(captured) });
  return encoder.encode(JSON.stringify(result)).length <= byteLimit ? result : undefined;
}
export function validMerchantCatalogImportChange(input: unknown): input is MerchantCatalogImportChange {
  return manifestFrom(input) !== undefined;
}

function invalidReceipt(): never { throw new DshPublicError(502, "OWNER_RESPONSE_INVALID"); }

function outcomeFrom(raw: unknown, expectedRow: number): MerchantCatalogImportOutcome {
  if (!record(raw)) invalidReceipt();
  const { row, status, reason, offerId, resultVersion } = raw;
  if (row !== expectedRow || typeof reason !== "string") invalidReceipt();
  if (status === "ACCEPTED" && reason === "UPDATED" && exact(raw, ["row", "status", "reason", "offerId", "resultVersion"]) &&
    typeof offerId === "string" && id.test(offerId) && integer(resultVersion, 2, Number.MAX_SAFE_INTEGER)) {
    return { row, status, reason, offerId, resultVersion };
  }
  if (exact(raw, ["row", "status", "reason"]) &&
    ((status === "FAILED" && reason === "OPERATION_CONFLICT") || (status === "HELD" && heldReasons.has(reason)))) {
    return { row, status, reason };
  }
  return invalidReceipt();
}

export function parseMerchantCatalogImportResult(payload: unknown, actorId: string, storeId: string, runId: string): MerchantCatalogImportResult {
  if (!record(payload) || !exact(payload, ["actorId", "storeId", "runId", "sourceSha256", "total", "processed", "offset", "outcomes"])) invalidReceipt();
  const { sourceSha256, total, processed, offset, outcomes } = payload;
  if (payload.actorId !== actorId || payload.storeId !== storeId || payload.runId !== runId ||
    typeof sourceSha256 !== "string" || !digest.test(sourceSha256) ||
    !integer(total, 1, maxRows) || !integer(processed, 0, total) || !integer(offset, 0, processed)) invalidReceipt();
  const length = Math.min(pageSize, processed - offset);
  if (!dense(outcomes, length, length)) invalidReceipt();
  const captured = outcomes.map((row, i) => outcomeFrom(row, offset + i + 2));
  return { actorId, storeId, runId, sourceSha256, total, processed, offset, outcomes: captured };
}

export function prepareMerchantCatalogImport(actorId: string, storeId: string, runId: string, method: ImportMethod, change?: MerchantCatalogImportChange, offset = 0) {
  const captured = method === "PUT" ? manifestFrom(change) : undefined;
  if (typeof actorId !== "string" || !actorId || typeof storeId !== "string" || !id.test(storeId) ||
    typeof runId !== "string" || !run.test(runId) || (method !== "GET" && method !== "PUT" && method !== "PATCH") ||
    !integer(offset, 0, maxRows) || (method !== "GET" && offset !== 0) ||
    (method === "PUT" ? !captured : change !== undefined)) throw new DshPublicError(400, "INVALID_REQUEST");
  const acceptResult = (payload: unknown): MerchantCatalogImportResult => {
    try {
      const result = parseMerchantCatalogImportResult(payload, actorId, storeId, runId);
      if (result.offset !== Math.min(offset, result.processed)) invalidReceipt();
      if (captured) {
        if (result.sourceSha256 !== captured.sourceSha256 || result.total !== captured.rows.length) invalidReceipt();
        for (const outcome of result.outcomes) {
          if (outcome.status !== "ACCEPTED") continue;
          const submitted = captured.rows[outcome.row - 2];
          if (!submitted || submitted.offerId !== outcome.offerId ||
            submitted.expectedVersion === undefined || outcome.resultVersion !== submitted.expectedVersion + 1) invalidReceipt();
        }
      }
      return result;
    } catch {
      throw new DshPublicError(502, method === "GET" ? "OWNER_RESPONSE_INVALID" : "OPERATION_RESULT_UNKNOWN");
    }
  };
  return { change: captured, acceptResult };
}

export async function merchantCatalogImport(origin: string, actorId: string, storeId: string, runId: string, bearer: string, method: ImportMethod, signal: AbortSignal, change?: MerchantCatalogImportChange, offset = 0): Promise<MerchantCatalogImportResult> {
  const prepared = prepareMerchantCatalogImport(actorId, storeId, runId, method, change, offset);
  const operation = method === "GET" ? dshOperations.readMerchantCatalogImport : method === "PUT" ? dshOperations.startMerchantCatalogImport : dshOperations.advanceMerchantCatalogImport;
  const path = operation.path.replace("{storeID}", storeId).replace("{runID}", runId) + (method === "GET" && offset ? "?offset=" + offset : "");
  return prepared.acceptResult(await privateOwnerRequest(origin, path, bearer, method, prepared.change, signal));
}
