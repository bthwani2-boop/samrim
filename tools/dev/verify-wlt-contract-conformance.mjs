import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const openApiPath = path.join(root, "services/wlt/contracts/openapi/wlt.openapi.yaml");
const clientPath = path.join(root, "services/dsh/backend/internal/integrations/wlt/client.go");
const openApi = fs.readFileSync(openApiPath, "utf8");
const client = fs.readFileSync(clientPath, "utf8");
const failures = [];

function pathShape(value) {
  return value
    .split("?", 1)[0]
    .replaceAll(/\{[^}]+\}/g, "{}")
    .replaceAll(/%[-+#0-9.]*[a-zA-Z]/g, "{}")
    .replaceAll(/\/+$/g, "");
}

const openApiPaths = new Set();
for (const line of openApi.split(/\r?\n/)) {
  const match = line.match(/^  (\/wlt\/[^:]+):\s*$/);
  if (match) openApiPaths.add(pathShape(match[1]));
}
if (openApiPaths.size < 10) failures.push(`WLT OpenAPI path census is unexpectedly small: ${openApiPaths.size}`);

const clientRouteLiterals = new Set();
for (const match of client.matchAll(/["`]([^"`\n]*\/wlt\/v1\/[^"`\n]*)["`]/g)) {
  const literal = match[1].replaceAll("\\/", "/");
  if (literal.includes("%!") || literal.includes("${")) continue;
  clientRouteLiterals.add(literal);
}
if (clientRouteLiterals.size < 10) failures.push(`DSH WLT client endpoint census is unexpectedly small: ${clientRouteLiterals.size}`);

for (const literal of [...clientRouteLiterals].sort()) {
  const shape = pathShape(literal);
  const hasFormatSlot = /%[-+#0-9.]*[a-zA-Z]/.test(literal);
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
  const line = rawLine.replace(/\s+$/g, "");
  if (line === "  schemas:") {
    inSchemas = true;
    current = null;
    continue;
  }
  if (!inSchemas) continue;
  if (/^[^ ]/.test(line) || /^  [A-Za-z]/.test(line)) {
    if (line !== "  schemas:") break;
  }
  const schemaMatch = line.match(/^    ([A-Za-z][A-Za-z0-9_]*):\s*$/);
  if (schemaMatch) {
    current = { name: schemaMatch[1], properties: new Set(), required: new Set(), closed: false };
    schemas.set(current.name.toLowerCase(), current);
    inProperties = false;
    collectingRequired = false;
    continue;
  }
  if (!current) continue;
  if (/^      additionalProperties:\s*false\s*$/.test(line)) current.closed = true;
  const inlineRequired = line.match(/^      required:\s*\[([^\]]*)\]\s*$/);
  if (inlineRequired) {
    for (const value of inlineRequired[1].split(",").map((item) => item.trim()).filter(Boolean)) current.required.add(value);
    collectingRequired = false;
    continue;
  }
  if (/^      required:\s*$/.test(line)) {
    collectingRequired = true;
    inProperties = false;
    continue;
  }
  if (collectingRequired) {
    const requiredItem = line.match(/^        -\s+([^#\s]+)\s*$/);
    if (requiredItem) {
      current.required.add(requiredItem[1]);
      continue;
    }
    if (!/^        /.test(line)) collectingRequired = false;
  }
  if (/^      properties:\s*$/.test(line)) {
    inProperties = true;
    collectingRequired = false;
    continue;
  }
  if (inProperties) {
    const propertyMatch = line.match(/^        ([A-Za-z][A-Za-z0-9_]*):(?:\s|$)/);
    if (propertyMatch) {
      current.properties.add(propertyMatch[1]);
      continue;
    }
    if (line && !/^        /.test(line)) inProperties = false;
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
  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`WLT_CONTRACT_CONFORMANCE=PASS openapi_paths=${openApiPaths.size} client_endpoints=${clientRouteLiterals.size} matched_schemas=${matchedSchemas.length}`);
