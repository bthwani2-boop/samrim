import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");
const openApiPath = path.join(root, "services/wlt/contracts/openapi/wlt.openapi.yaml");
const clientPaths = [
  path.join(root, "services/dsh/backend/internal/integrations/wlt/client.go"),
  path.join(root, "services/dsh/backend/internal/integrations/wlt/store_payout_recipient.go"),
];
const openApi = fs.readFileSync(openApiPath, "utf8");
const client = clientPaths.map((clientPath) => fs.readFileSync(clientPath, "utf8")).join("\n");
const failures = [];

function replaceBracePlaceholders(value) {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf("{", cursor);
    if (open < 0) return result + value.slice(cursor);
    const close = value.indexOf("}", open + 1);
    if (close < 0) return result + value.slice(cursor);
    result += value.slice(cursor, open) + "{}";
    cursor = close + 1;
  }
  return result;
}

function isFormatFlag(character) {
  return character === "-" || character === "+" || character === "#" || character === "." || (character >= "0" && character <= "9");
}

function isAsciiLetter(character) {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function normalizeFormatSlots(value) {
  let result = "";
  let cursor = 0;
  let found = false;
  while (cursor < value.length) {
    if (value[cursor] !== "%") {
      result += value[cursor];
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < value.length && isFormatFlag(value[end])) end += 1;
    if (end < value.length && isAsciiLetter(value[end])) {
      result += "{}";
      cursor = end + 1;
      found = true;
      continue;
    }
    result += value[cursor];
    cursor += 1;
  }
  return { value: result, found };
}

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function pathShape(value) {
  const withoutQuery = value.split("?", 1)[0];
  const bracesNormalized = replaceBracePlaceholders(withoutQuery);
  const formatNormalized = normalizeFormatSlots(bracesNormalized).value;
  return trimTrailingSlashes(formatNormalized);
}

function identifier(value) {
  return /^\w+$/.test(value) && /^[A-Za-z]/.test(value);
}

function indentedKey(line, indent) {
  const prefix = " ".repeat(indent);
  if (!line.startsWith(prefix) || line.startsWith(prefix + " ")) return null;
  const content = line.slice(indent);
  const separator = content.indexOf(":");
  if (separator < 1) return null;
  const key = content.slice(0, separator);
  return identifier(key) ? key : null;
}

const openApiPaths = new Set();
for (const line of openApi.split(/\r?\n/)) {
  if (!line.startsWith("  /wlt/") || !line.endsWith(":")) continue;
  openApiPaths.add(pathShape(line.slice(2, -1)));
}
if (openApiPaths.size < 10) failures.push(`WLT OpenAPI path census is unexpectedly small: ${openApiPaths.size}`);

const clientRouteLiterals = new Set();
for (const match of client.matchAll(/["`]([^"`\n]*\/wlt\/v1\/[^"`\n]*)["`]/g)) {
  const literal = match[1].replaceAll(String.raw`\/`, "/");
  if (literal.includes("%!") || literal.includes("${")) continue;
  clientRouteLiterals.add(literal);
}
if (clientRouteLiterals.size < 10) failures.push(`DSH WLT client endpoint census is unexpectedly small: ${clientRouteLiterals.size}`);

for (const literal of [...clientRouteLiterals].toSorted(compareStrings)) {
  const shape = pathShape(literal);
  const hasFormatSlot = normalizeFormatSlots(literal).found;
  const matched = hasFormatSlot
    ? openApiPaths.has(shape)
    : [...openApiPaths].some((candidate) => candidate === shape || candidate.startsWith(`${shape}/`) || shape.startsWith(`${candidate}/`));
  if (!matched) failures.push(`DSH WLT client endpoint is absent from canonical OpenAPI: ${literal}`);
}

const schemas = new Map();
let inSchemas = false;
let current = null;
let inProperties = false;
let collectingRequired = false;
for (const rawLine of openApi.split(/\r?\n/)) {
  const line = rawLine.trimEnd();
  if (line === "  schemas:") {
    inSchemas = true;
    current = null;
    continue;
  }
  if (!inSchemas) continue;
  if (line && !line.startsWith(" ")) break;
  if (line.startsWith("  ") && !line.startsWith("    ") && line !== "  schemas:") break;

  const schemaName = indentedKey(line, 4);
  if (schemaName && line === `    ${schemaName}:`) {
    current = { name: schemaName, properties: new Set(), required: new Set(), closed: false };
    schemas.set(current.name.toLowerCase(), current);
    inProperties = false;
    collectingRequired = false;
    continue;
  }
  if (!current) continue;

  if (line === "      additionalProperties: false") current.closed = true;

  if (line.startsWith("      required: [") && line.endsWith("]")) {
    const values = line.slice("      required: [".length, -1);
    for (const value of values.split(",").map((item) => item.trim()).filter(Boolean)) current.required.add(value);
    collectingRequired = false;
    continue;
  }
  if (line === "      required:") {
    collectingRequired = true;
    inProperties = false;
    continue;
  }
  if (collectingRequired) {
    if (line.startsWith("        - ")) {
      const requiredItem = line.slice("        - ".length).trim();
      if (requiredItem && !requiredItem.includes("#") && !/\s/.test(requiredItem)) {
        current.required.add(requiredItem);
        continue;
      }
    }
    if (!line.startsWith("        ")) collectingRequired = false;
  }
  if (line === "      properties:") {
    inProperties = true;
    collectingRequired = false;
    continue;
  }
  if (inProperties) {
    const propertyName = indentedKey(line, 8);
    if (propertyName) {
      current.properties.add(propertyName);
      continue;
    }
    if (line && !line.startsWith("        ")) inProperties = false;
  }
}
if (schemas.size < 10) failures.push(`WLT OpenAPI schema census is unexpectedly small: ${schemas.size}`);

const matchedSchemas = [];
const structPattern = /type\s+([A-Za-z][A-Za-z0-9_]*)\s+struct\s*\{([\s\S]*?)\n\}/g;
for (const match of client.matchAll(structPattern)) {
  const [, structName, body] = match;
  const jsonFields = new Set();
  for (const fieldMatch of body.matchAll(/`json:"([^",]+)(?:,[^"]*)?"`/g)) {
    if (fieldMatch[1] !== "-") jsonFields.add(fieldMatch[1]);
  }
  if (jsonFields.size === 0) continue;
  const schema = schemas.get(structName.toLowerCase());
  if (!schema) continue;
  matchedSchemas.push(schema.name);
  for (const field of jsonFields) {
    if (schema.closed && !schema.properties.has(field)) {
      failures.push(`${structName}: JSON field ${field} is absent from closed OpenAPI schema ${schema.name}`);
    }
  }
  for (const field of schema.required) {
    if (!jsonFields.has(field)) failures.push(`${structName}: required OpenAPI field ${field} is absent from Go client DTO`);
  }
}
if (matchedSchemas.length < 5) failures.push(`WLT client/OpenAPI schema overlap is unexpectedly small: ${matchedSchemas.length}`);

if (failures.length) {
  console.error("WLT_CONTRACT_CONFORMANCE=FAIL");
  for (const failure of [...new Set(failures)].toSorted(compareStrings)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`WLT_CONTRACT_CONFORMANCE=PASS openapi_paths=${openApiPaths.size} client_endpoints=${clientRouteLiterals.size} matched_schemas=${matchedSchemas.length}`);
