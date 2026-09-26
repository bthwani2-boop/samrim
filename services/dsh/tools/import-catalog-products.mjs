import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

function required(name, explicit) {
  const value = (explicit || process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function normalizeRow(row, line) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`line ${line}: row must be an object`);
  const value = (key) => typeof row[key] === "string" ? row[key].trim() : "";
  const canonicalName = value("canonicalName");
  const verticalId = value("verticalId").toLowerCase();
  const scope = value("scope").toUpperCase();
  const measurementKind = value("measurementKind").toUpperCase();
  const baseUnit = value("baseUnit").toUpperCase();
  const variantTitle = value("variantTitle") || "الافتراضي";
  const storeId = value("storeId");
  const brand = value("brand");
  const identifierType = value("identifierType").toUpperCase();
  const identifierValue = value("identifierValue") || value("barcode");
  if (value("imageUri") || value("canonicalImageUrl")) throw new Error(`line ${line}: Product images must be uploaded through the canonical media upload after import`);
  const rawCategories = Array.isArray(row.categoryIds) ? row.categoryIds : value("categoryIds").split(/[|;]/);
  const categoryIds = [...new Set(rawCategories.map((item) => String(item).trim()).filter(Boolean))];
  if (!canonicalName || [...canonicalName].length > 160) throw new Error(`line ${line}: canonicalName must contain 1..160 characters`);
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(verticalId)) throw new Error(`line ${line}: verticalId is required and must be a canonical registry ID`);
  if (!["SHARED", "STORE_SCOPED"].includes(scope)) throw new Error(`line ${line}: scope must be SHARED or STORE_SCOPED`);
  if (!["DISCRETE", "MEASURED", "VARIABLE_MEASURE"].includes(measurementKind)) throw new Error(`line ${line}: measurementKind must be DISCRETE, MEASURED, or VARIABLE_MEASURE`);
  if ((measurementKind === "DISCRETE" && baseUnit !== "COUNT") || (measurementKind !== "DISCRETE" && !["GRAM", "MILLILITER"].includes(baseUnit))) throw new Error(`line ${line}: baseUnit is inconsistent with measurementKind`);
  if (!variantTitle || [...variantTitle].length > 160) throw new Error(`line ${line}: variantTitle must contain 1..160 characters`);
  if (brand && [...brand].length > 160) throw new Error(`line ${line}: brand is too long`);
  if (!categoryIds.length) throw new Error(`line ${line}: categoryIds must contain at least one explicit category`);
  if (scope === "STORE_SCOPED" && !storeId) throw new Error(`line ${line}: storeId is required for STORE_SCOPED imports`);
  if (scope === "SHARED" && storeId) throw new Error(`line ${line}: storeId is forbidden for SHARED imports`);
  if (identifierValue && !["GTIN", "EAN", "UPC", "SKU"].includes(identifierType)) throw new Error(`line ${line}: identifierType is required for a typed identifier`);
  if (identifierValue && !/^[A-Za-z0-9._-]{1,128}$/.test(identifierValue)) throw new Error(`line ${line}: identifierValue is invalid`);
  return { verticalId, scope, ...(storeId ? { storeId } : {}), canonicalName, ...(brand ? { brand } : {}), variantTitle, measurementKind, baseUnit, categoryIds, ...(identifierValue ? { identifierType, identifierValue } : {}) };
}

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  let recordStart = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) { record.push(value); value = ""; continue; }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(value); value = "";
      if (record.some((item) => item.trim())) records.push({ line: recordStart, values: record });
      record = [];
      recordStart = index + 2;
      continue;
    }
    value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value");
  if (value.length || record.length) {
    record.push(value);
    if (record.some((item) => item.trim())) records.push({ line: recordStart, values: record });
  }
  return records;
}

function readRows(file) {
  const extension = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, "utf8");
  if (extension === ".csv") {
    const records = parseCsvRecords(text);
    if (!records.length) return [];
    const header = records[0].values.map((value) => value.trim());
    return records.slice(1).map((entry) => ({ line: entry.line, row: Object.fromEntries(header.map((name, index) => [name, entry.values[index] || ""])) }));
  }
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, value: line })).filter((entry) => entry.value.trim() && !entry.value.trim().startsWith("#")).map((entry) => {
    try { return { line: entry.line, row: JSON.parse(entry.value) }; } catch { throw new Error(`line ${entry.line}: invalid JSON`); }
  });
}

function stableKey(input) {
  if (input.identifierValue) return `identifier:${input.identifierType}:${input.identifierValue}`;
  return `facts:${input.verticalId}:${input.scope}:${input.canonicalName}:${input.variantTitle}:${input.measurementKind}:${input.baseUnit}`;
}

async function requestJSON(baseUrl, token, actorID, pathname, method = "GET", body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(actorID ? { "X-Acting-Actor-ID": actorID } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const file = argument("file");
if (!file) throw new Error("--file=JSONL_OR_CSV_REQUIRED");
const inputPath = path.resolve(file);
if (!fs.existsSync(inputPath)) throw new Error(`IMPORT_FILE_NOT_FOUND:${inputPath}`);
const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex");
const mode = argument("mode") || "preview";
if (!["preview", "commit"].includes(mode)) throw new Error("--mode_MUST_BE_PREVIEW_OR_COMMIT");
const baseUrl = required("DSH_API_BASE_URL", argument("base-url")).replace(/\/+$/, "");
const token = required("CONTROL_PANEL_SERVICE_TOKEN", argument("service-token"));
const actorID = required("CATALOG_IMPORT_ACTOR_ID", argument("actor-id"));
const resumeFrom = Math.max(1, Number(argument("resume-from") || "1"));
if (!Number.isSafeInteger(resumeFrom)) throw new Error("--resume-from_MUST_BE_A_POSITIVE_INTEGER");
const reportPath = path.resolve(argument("report") || argument("conflicts") || `${inputPath}.catalog-import.json`);
const rows = readRows(inputPath);
const runId = argument("run-id") || `catalog-import-${sourceSha256.slice(0, 32)}`;
const inputRows = [];
const localInvalid = [];
for (const entry of rows) {
  try {
    const input = normalizeRow(entry.row, entry.line);
    inputRows.push({ rowNumber: entry.line, stableKey: stableKey(input), ...input });
  } catch (error) {
    localInvalid.push({ line: entry.line, kind: "INVALID_INPUT", message: error instanceof Error ? error.message : String(error) });
  }
}
if (!inputRows.length) throw new Error(`IMPORT_INPUT_INVALID:${JSON.stringify(localInvalid)}`);
const previewKey = `catalog-import-preview-${sourceSha256}`;
const preview = await requestJSON(baseUrl, token, actorID, "/dsh/catalog/imports/preview", "POST", { runId, sourceSha256, rows: inputRows }, { "X-Correlation-ID": `${runId}-preview`, "Idempotency-Key": previewKey });
if (preview.status !== 201 && preview.status !== 200) throw new Error(`catalog import preview failed: HTTP ${preview.status} ${preview.body?.error?.message || ""}`);
let result = preview.body;
if (mode === "commit") {
  const commitKey = `catalog-import-commit-${sourceSha256}`;
  const commit = await requestJSON(baseUrl, token, actorID, `/dsh/catalog/imports/${encodeURIComponent(runId)}/commit`, "POST", undefined, { "X-Correlation-ID": `${runId}-commit`, "Idempotency-Key": commitKey });
  if (commit.status !== 200) throw new Error(`catalog import commit failed: HTTP ${commit.status} ${commit.body?.error?.message || ""}`);
  result = commit.body;
}
const items = Array.isArray(result?.items) ? result.items : [];
const report = { file: inputPath, sourceSha256, mode, runId, resumeFrom, run: result?.run || null, rows: [...items, ...localInvalid], imported: items.filter((item) => item.classification === "IMPORTED").length, replayed: items.filter((item) => item.classification === "REPLAYED").length, duplicates: items.filter((item) => item.classification === "DUPLICATE_INPUT" || item.classification === "DUPLICATE_EXISTING").length, conflicts: items.filter((item) => item.classification === "CONFLICT_EXISTING" || item.classification === "FAILED").length, invalid: items.filter((item) => item.classification === "INVALID_INPUT").length + localInvalid.length };
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`CATALOG_IMPORT mode=${mode} run=${runId} imported=${report.imported} replayed=${report.replayed} duplicates=${report.duplicates} conflicts=${report.conflicts} invalid=${report.invalid} report=${reportPath}`);
if (report.conflicts || report.invalid) process.exitCode = 2;
