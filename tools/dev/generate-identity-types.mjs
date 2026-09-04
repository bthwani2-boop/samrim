import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "services/identity/contracts/identity.openapi.yaml");
const outputPath = path.join(root, "services/identity/clients/generated/identity-types.ts");
const source = fs.readFileSync(contractPath, "utf8");
const sourceBlobSha = crypto
  .createHash("sha1")
  .update("blob " + Buffer.byteLength(source, "utf8") + "\0" + source)
  .digest("hex");

const schemaNames = [
  "StatusResponse",
  "ActorType",
  "OtpRequest",
  "ActivationRequest",
  "ActivationChallenge",
  "LoginRequest",
  "RefreshRequest",
  "ActorIdentity",
  "TokenPair",
  "ProvisionActorRoleRequest",
  "ActorRoleView",
  "ActorRoleSearchPage",
  "PasswordResetRequest",
  "SessionInfo",
];

const sourceLines = source.split("\n");
const schemaNameSet = new Set(schemaNames);
const referencedSchemas = new Set();

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function findSchemaLines(name) {
  const marker = "    " + name + ":";
  const start = sourceLines.findIndex((line) => line === marker);
  if (start < 0) throw new Error("missing OpenAPI schema " + name);

  let end = sourceLines.length;
  for (let index = start + 1; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    if (indentOf(line) === 4 && /^[A-Za-z0-9_]+:$/.test(line.trim())) {
      end = index;
      break;
    }
  }
  return sourceLines.slice(start + 1, end);
}

function valueAfter(lines, prefix, indent) {
  const expected = " ".repeat(indent) + prefix;
  const line = lines.find((candidate) => candidate.startsWith(expected));
  return line ? line.slice(expected.length).trim() : null;
}

function literal(value) {
  const trimmed = value.trim();
  if (trimmed === "true" || trimmed === "false" || /^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
    return trimmed;
  }
  return JSON.stringify(trimmed.replace(/^["']|["']$/g, ""));
}

function inlineEnum(value) {
  const match = value.match(/^\[([^\]]*)\]$/);
  if (!match) throw new Error("only inline enums are supported: " + value);
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(literal)
    .join(" | ");
}

function refType(value) {
  const match = value.match(/^["']?#\/components\/schemas\/([A-Za-z0-9_]+)["']?$/);
  if (!match) throw new Error("unsupported schema reference " + value);
  referencedSchemas.add(match[1]);
  return match[1];
}

function propertyType(lines, context) {
  const ref = valueAfter(lines, "$ref:", 10);
  if (ref) return refType(ref);

  const constant = valueAfter(lines, "const:", 10);
  if (constant !== null) return literal(constant);

  const enumValue = valueAfter(lines, "enum:", 10);
  if (enumValue) return inlineEnum(enumValue);

  const type = valueAfter(lines, "type:", 10);
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const itemsIndex = lines.findIndex((line) => line === "          items:");
      if (itemsIndex < 0) throw new Error(context + " array is missing items");
      const itemLines = lines.slice(itemsIndex + 1);
      const itemRef = valueAfter(itemLines, "$ref:", 12);
      if (itemRef) return "ReadonlyArray<" + refType(itemRef) + ">";
      const itemType = valueAfter(itemLines, "type:", 12);
      if (itemType === "string") return "ReadonlyArray<string>";
      if (itemType === "integer" || itemType === "number") return "ReadonlyArray<number>";
      if (itemType === "boolean") return "ReadonlyArray<boolean>";
      throw new Error(context + " has unsupported array item type");
    }
    case "object": {
      const additionalIndex = lines.findIndex((line) => line === "          additionalProperties:");
      if (additionalIndex < 0) throw new Error(context + " has unsupported object shape");
      const valueLines = lines.slice(additionalIndex + 1);
      const valueType = valueAfter(valueLines, "type:", 12);
      if (valueType === "string") return "Readonly<Record<string, string>>";
      if (valueType === "boolean") return "Readonly<Record<string, boolean>>";
      if (valueType === "integer" || valueType === "number") return "Readonly<Record<string, number>>";
      throw new Error(context + " has unsupported map value type");
    }
    default:
      throw new Error(context + " has unsupported property type " + JSON.stringify(type));
  }
}

function renderObject(name, lines) {
  const requiredValue = valueAfter(lines, "required:", 6);
  const required = new Set();
  if (requiredValue) {
    const match = requiredValue.match(/^\[([^\]]*)\]$/);
    if (!match) throw new Error(name + " required list must be inline");
    for (const item of match[1].split(",").map((part) => part.trim()).filter(Boolean)) required.add(item);
  }

  const propertiesIndex = lines.findIndex((line) => line === "      properties:");
  if (propertiesIndex < 0) throw new Error(name + " is missing properties");

  const region = lines.slice(propertiesIndex + 1);
  const starts = [];
  for (let index = 0; index < region.length; index++) {
    const line = region[index];
    if (indentOf(line) === 8 && /^[A-Za-z0-9_]+:$/.test(line.trim())) {
      starts.push({ index, name: line.trim().slice(0, -1) });
    }
  }
  if (starts.length === 0) throw new Error(name + " has no properties");

  const rendered = starts.map((property, index) => {
    const next = starts[index + 1];
    const block = region.slice(property.index + 1, next ? next.index : region.length);
    const optional = required.has(property.name) ? "" : "?";
    return "  readonly " + property.name + optional + ": " + propertyType(block, name + "." + property.name) + ";";
  });

  for (const requiredProperty of required) {
    if (!starts.some((property) => property.name === requiredProperty)) {
      throw new Error(name + " requires missing property " + requiredProperty);
    }
  }

  return "export type " + name + " = {\n" + rendered.join("\n") + "\n};";
}

function renderSchema(name) {
  const lines = findSchemaLines(name);
  const type = valueAfter(lines, "type:", 6);

  if (type === "object") return renderObject(name, lines);
  if (type === "string") {
    const constant = valueAfter(lines, "const:", 6);
    if (constant !== null) return "export type " + name + " = " + literal(constant) + ";";
    const enumValue = valueAfter(lines, "enum:", 6);
    if (enumValue) return "export type " + name + " = " + inlineEnum(enumValue) + ";";
    return "export type " + name + " = string;";
  }

  throw new Error(name + " has unsupported top-level schema type " + JSON.stringify(type));
}

export function generateIdentityTypes() {
  referencedSchemas.clear();
  const rendered = schemaNames.map(renderSchema);

  const missing = [...referencedSchemas].filter((name) => !schemaNameSet.has(name)).sort();
  if (missing.length > 0) {
    throw new Error("generated schema closure is missing referenced types: " + missing.join(", "));
  }

  const header = [
    "/**",
    " * AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml.",
    " * Source Git blob SHA: " + sourceBlobSha,
    " * Generated by tools/dev/generate-identity-types.mjs. DO NOT EDIT.",
    " */",
    "",
  ].join("\n");

  return header + rendered.join("\n\n") + "\n";
}

const generated = generateIdentityTypes();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== generated) {
    console.error("IDENTITY_GENERATED_TYPES=DRIFT");
    process.exit(1);
  }
  console.log("IDENTITY_GENERATED_TYPES=PASS blob=" + sourceBlobSha);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated, "utf8");
  console.log("IDENTITY_GENERATED_TYPES=WRITTEN blob=" + sourceBlobSha);
}
