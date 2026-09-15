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
  const sellUnit = value("sellUnit").toLowerCase();
  const variantTitle = value("variantTitle") || "الافتراضي";
  const brand = value("brand");
  const identifierType = value("identifierType").toUpperCase();
  const identifierValue = value("identifierValue") || value("barcode");
  const imageUri = value("imageUri") || value("canonicalImageUrl");
  const rawCategories = Array.isArray(row.categoryIds) ? row.categoryIds : value("categoryIds").split(/[|;]/);
  const categoryIds = [...new Set(rawCategories.map((item) => String(item).trim()).filter(Boolean))];
  if (!canonicalName || [...canonicalName].length > 160) throw new Error(`line ${line}: canonicalName must contain 1..160 characters`);
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(verticalId)) throw new Error(`line ${line}: verticalId is required and must be a canonical registry ID`);
  if (!["SHARED", "STORE_SCOPED"].includes(scope)) throw new Error(`line ${line}: scope must be SHARED or STORE_SCOPED`);
  if (!["piece", "kg"].includes(sellUnit)) throw new Error(`line ${line}: sellUnit must be piece or kg`);
  if (!variantTitle || [...variantTitle].length > 160) throw new Error(`line ${line}: variantTitle must contain 1..160 characters`);
  if (brand && [...brand].length > 160) throw new Error(`line ${line}: brand is too long`);
  if (!categoryIds.length) throw new Error(`line ${line}: categoryIds must contain at least one explicit category`);
  if (identifierValue && !["GTIN", "EAN", "UPC", "SKU"].includes(identifierType)) throw new Error(`line ${line}: identifierType is required for a typed identifier`);
  if (identifierValue && !/^[A-Za-z0-9._-]{1,128}$/.test(identifierValue)) throw new Error(`line ${line}: identifierValue is invalid`);
  if (imageUri) {
    let parsed;
    try { parsed = new URL(imageUri); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error(`line ${line}: imageUri must be an http(s) URL without credentials`);
  }
  return { verticalId, scope, canonicalName, ...(brand ? { brand } : {}), variantTitle, sellUnit, categoryIds, ...(identifierValue ? { identifierType, identifierValue } : {}), ...(imageUri ? { imageUri } : {}) };
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
    const headerIndex = lines.findIndex((line) => line.trim());
    if (headerIndex < 0) return [];
    const header = parseCsvLine(lines[headerIndex]).map((value) => value.trim());
    return lines.slice(headerIndex + 1).map((line, offset) => ({ line: headerIndex + offset + 2, value: line })).filter((entry) => entry.value.trim()).map((entry) => ({ line: entry.line, row: Object.fromEntries(header.map((name, index) => [name, parseCsvLine(entry.value)[index] || ""])) }));
  }
  return lines.map((line, index) => ({ line: index + 1, value: line })).filter((entry) => entry.value.trim() && !entry.value.trim().startsWith("#")).map((entry) => {
    try { return { line: entry.line, row: JSON.parse(entry.value) }; } catch { throw new Error(`line ${entry.line}: invalid JSON`); }
  });
}

function stableKey(input) {
  if (input.identifierValue) return `identifier:${input.identifierType}:${input.identifierValue}`;
  return `facts:${input.verticalId}:${input.scope}:${input.canonicalName}:${input.variantTitle}:${input.sellUnit}`;
}

function sameSet(left, right) {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function sameFacts(input, product, variant) {
  const primaryImage = product.media.find((item) => item.role === "primary")?.uri || "";
  return product.verticalId === input.verticalId && product.scope === input.scope && product.canonicalName === input.canonicalName && (product.brand || "") === (input.brand || "") && variant.title === input.variantTitle && variant.sellUnit === input.sellUnit && sameSet(product.categoryIds, input.categoryIds) && primaryImage === (input.imageUri || "");
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

async function listExisting(baseUrl, token, actorID, verticalId) {
  const query = new URLSearchParams({ verticalId, limit: "100" });
  const result = await requestJSON(baseUrl, token, actorID, `/dsh/catalog/products?${query.toString()}`);
  if (result.status !== 200 || !Array.isArray(result.body?.products)) throw new Error(`catalog readback failed while classifying ${verticalId}: HTTP ${result.status}`);
  return result.body.products;
}

function classify(input, products) {
  for (const product of products) {
    for (const variant of product.variants || []) {
      const identifierMatch = input.identifierValue && (variant.identifiers || []).some((item) => item.type === input.identifierType && item.value === input.identifierValue);
      const factsMatch = !input.identifierValue && stableKey(input) === `facts:${product.verticalId}:${product.scope}:${product.canonicalName}:${variant.title}:${variant.sellUnit}`;
      if (identifierMatch || factsMatch) return { kind: sameFacts(input, product, variant) ? "DUPLICATE_EXISTING" : "CONFLICT_EXISTING", productId: product.id, variantId: variant.id };
    }
  }
  return { kind: "READY" };
}

async function createProduct(baseUrl, token, actorID, input) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const headers = { "X-Correlation-ID": `catalog-import-${digest.slice(0, 32)}`, "Idempotency-Key": `catalog-import-${digest}` };
  const result = await requestJSON(baseUrl, token, actorID, "/dsh/catalog/products", "POST", input, headers);
  if (result.status !== 201 && result.status !== 200) return { kind: result.body?.error?.code || "DSH_ERROR", status: result.status, message: result.body?.error?.message || `HTTP ${result.status}` };
  const product = result.body?.product;
  if (!product?.id || !product.variants?.length) return { kind: "READBACK_INCOMPLETE", status: result.status };
  const query = new URLSearchParams({ verticalId: input.verticalId, q: input.canonicalName, limit: "100" });
  const readback = await requestJSON(baseUrl, token, actorID, `/dsh/catalog/products?${query.toString()}`);
  if (readback.status !== 200 || !readback.body?.products?.some((item) => item.id === product.id)) return { kind: "READBACK_MISSING", status: readback.status };
  return { kind: result.body.idempotentReplay ? "REPLAYED" : "IMPORTED", productId: product.id, variantId: product.variants[0].id };
}

const file = argument("file");
if (!file) throw new Error("--file=JSONL_OR_CSV_REQUIRED");
const inputPath = path.resolve(file);
if (!fs.existsSync(inputPath)) throw new Error(`IMPORT_FILE_NOT_FOUND:${inputPath}`);
const mode = argument("mode") || "preview";
if (!["preview", "commit"].includes(mode)) throw new Error("--mode_MUST_BE_PREVIEW_OR_COMMIT");
const baseUrl = required("DSH_API_BASE_URL", argument("base-url")).replace(/\/+$/, "");
const token = required("CONTROL_PANEL_SERVICE_TOKEN", argument("service-token"));
const actorID = required("CATALOG_IMPORT_ACTOR_ID", argument("actor-id"));
const resumeFrom = Math.max(1, Number(argument("resume-from") || "1"));
if (!Number.isSafeInteger(resumeFrom)) throw new Error("--resume-from_MUST_BE_A_POSITIVE_INTEGER");
const reportPath = path.resolve(argument("report") || argument("conflicts") || `${inputPath}.catalog-import.json`);
const rows = readRows(inputPath).filter((entry) => entry.line >= resumeFrom);
const report = { file: inputPath, mode, resumeFrom, rows: [], imported: 0, replayed: 0, duplicates: 0, conflicts: 0, invalid: 0 };
const seen = new Map();
const productsByVertical = new Map();

for (const entry of rows) {
  let input;
  try { input = normalizeRow(entry.row, entry.line); }
  catch (error) {
    report.invalid += 1;
    report.rows.push({ line: entry.line, kind: "INVALID_INPUT", message: error instanceof Error ? error.message : String(error) });
    continue;
  }
  const key = stableKey(input);
  if (seen.has(key)) {
    report.duplicates += 1;
    report.rows.push({ line: entry.line, kind: "DUPLICATE_INPUT", duplicateOfLine: seen.get(key), input });
    continue;
  }
  seen.set(key, entry.line);
  if (!productsByVertical.has(input.verticalId)) productsByVertical.set(input.verticalId, await listExisting(baseUrl, token, actorID, input.verticalId));
  const classification = classify(input, productsByVertical.get(input.verticalId));
  if (classification.kind === "DUPLICATE_EXISTING") report.duplicates += 1;
  if (classification.kind === "CONFLICT_EXISTING") report.conflicts += 1;
  report.rows.push({ line: entry.line, kind: classification.kind, ...(classification.productId ? { productId: classification.productId } : {}), ...(classification.variantId ? { variantId: classification.variantId } : {}), input });
}

if (mode === "commit") {
  for (const item of report.rows.filter((row) => row.kind === "READY")) {
    const result = await createProduct(baseUrl, token, actorID, item.input);
    item.commit = result;
    if (result.kind === "IMPORTED") report.imported += 1;
    else if (result.kind === "REPLAYED") report.replayed += 1;
    else report.conflicts += 1;
  }
}

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`CATALOG_IMPORT mode=${mode} imported=${report.imported} replayed=${report.replayed} duplicates=${report.duplicates} conflicts=${report.conflicts} invalid=${report.invalid} report=${reportPath}`);
if (report.conflicts || report.invalid) process.exitCode = 2;
