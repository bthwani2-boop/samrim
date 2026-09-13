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
  const sellUnit = value("sellUnit").toLowerCase();
  const brand = value("brand");
  const barcode = value("barcode");
  const canonicalImageUrl = value("canonicalImageUrl");
  if (!canonicalName || [...canonicalName].length > 160) throw new Error(`line ${line}: canonicalName must contain 1..160 characters`);
  if (!["piece", "kg"].includes(sellUnit)) throw new Error(`line ${line}: sellUnit must be piece or kg`);
  if (brand && [...brand].length > 160) throw new Error(`line ${line}: brand is too long`);
  if (barcode && !/^\d{8,14}$/.test(barcode)) throw new Error(`line ${line}: barcode must contain 8..14 digits`);
  if (canonicalImageUrl) {
    let parsed;
    try { parsed = new URL(canonicalImageUrl); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error(`line ${line}: canonicalImageUrl must be an http(s) URL without credentials`);
  }
  return { canonicalName, sellUnit, ...(brand ? { brand } : {}), ...(barcode ? { barcode } : {}), ...(canonicalImageUrl ? { canonicalImageUrl } : {}) };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { values.push(value); value = ""; continue; }
    value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value");
  values.push(value);
  return values;
}

function readRows(file) {
  const extension = path.extname(file).toLowerCase();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (extension === ".csv") {
    const headerLine = lines.find((line) => line.trim());
    if (!headerLine) return [];
    const header = parseCsvLine(headerLine).map((value) => value.trim());
    const headerIndex = lines.indexOf(headerLine);
    return lines.slice(headerIndex + 1).map((line, offset) => ({ line: headerIndex + offset + 2, value: line })).filter((entry) => entry.value.trim()).map((entry) => {
      const values = parseCsvLine(entry.value);
      return { line: entry.line, row: Object.fromEntries(header.map((name, index) => [name, values[index] || ""])) };
    });
  }
  return lines.map((line, index) => ({ line: index + 1, value: line })).filter((entry) => entry.value.trim() && !entry.value.trim().startsWith("#")).map((entry) => {
    try { return { line: entry.line, row: JSON.parse(entry.value) }; } catch { throw new Error(`line ${entry.line}: invalid JSON`); }
  });
}

async function requestProduct(baseUrl, token, actorID, input, idempotencyKey, correlationID) {
  const response = await fetch(`${baseUrl}/dsh/catalog/products`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Acting-Actor-ID": actorID, "X-Correlation-ID": correlationID, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const nested = body?.error;
    const error = new Error(typeof nested?.message === "string" ? nested.message : `HTTP ${response.status}`);
    error.code = typeof nested?.code === "string" ? nested.code : "DSH_ERROR";
    error.status = response.status;
    throw error;
  }
  return body;
}

const file = argument("file");
if (!file) throw new Error("--file=JSONL_OR_CSV_REQUIRED");
const inputPath = path.resolve(file);
if (!fs.existsSync(inputPath)) throw new Error(`IMPORT_FILE_NOT_FOUND:${inputPath}`);
const baseUrl = required("DSH_API_BASE_URL", argument("base-url")).replace(/\/+$/, "");
const token = required("CONTROL_PANEL_SERVICE_TOKEN", argument("service-token"));
const actorID = required("CENTRAL_PRODUCT_IMPORT_ACTOR_ID", argument("actor-id"));
const resumeFrom = Math.max(1, Number(argument("resume-from") || "1"));
if (!Number.isSafeInteger(resumeFrom)) throw new Error("--resume-from_MUST_BE_A_POSITIVE_INTEGER");
const conflictPath = path.resolve(argument("conflicts") || `${inputPath}.conflicts.json`);
const rows = readRows(inputPath);
const conflicts = [];
let imported = 0;
let replayed = 0;

for (const entry of rows) {
  if (entry.line < resumeFrom) continue;
  let input;
  try {
    input = normalizeRow(entry.row, entry.line);
  } catch (error) {
    conflicts.push({ line: entry.line, code: "INVALID_INPUT", message: error instanceof Error ? error.message : String(error), row: entry.row });
    continue;
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  try {
    const result = await requestProduct(baseUrl, token, actorID, input, `central-product-import-${digest}`, `central-product-import-${digest.slice(0, 32)}`);
    if (result?.idempotentReplay === true) replayed += 1;
    else imported += 1;
  } catch (error) {
    conflicts.push({ line: entry.line, code: error?.code || "DSH_ERROR", status: error?.status, message: error instanceof Error ? error.message : String(error), input });
  }
}

fs.writeFileSync(conflictPath, `${JSON.stringify({ file: inputPath, resumeFrom, imported, replayed, conflicts }, null, 2)}\n`, "utf8");
console.log(`CENTRAL_PRODUCT_IMPORT imported=${imported} replayed=${replayed} conflicts=${conflicts.length} report=${conflictPath}`);
if (conflicts.length > 0) process.exitCode = 2;
