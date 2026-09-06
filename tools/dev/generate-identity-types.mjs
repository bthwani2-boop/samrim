import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "services/identity/contracts/identity.openapi.yaml");
const outputPath = path.join(root, "services/identity/clients/generated/identity-types.ts");
const operationsOutputPath = path.join(root, "services/identity/clients/generated/identity-operations.ts");
const goOutputPath = path.join(root, "services/identity/clients/go/identity_types_generated.go");
const goOperationsOutputPath = path.join(root, "services/identity/clients/go/identity_operations_generated.go");
const source = fs.readFileSync(contractPath, "utf8");
const sourceBlobSha = crypto
  .createHash("sha1")
  .update("blob " + Buffer.byteLength(source, "utf8") + "\0" + source)
  .digest("hex");

const schemaNames = [
  "StatusResponse",
  "ActorType",
  "ManagedActorType",
  "ManagedActivationRole",
  "ControlPanelRole",
  "PhoneRequest",
  "ManagedChallengeRequest",
  "ManagedRecoveryChallengeRequest",
  "OperatorEnrollmentTokenIssueRequest",
  "OperatorEnrollmentToken",
  "ClientCredentialProofRequest",
  "PasswordLoginRequest",
  "ManagedPasswordLoginRequest",
  "ManagedActivationRequest",
  "ManagedRecoveryRequest",
  "OperatorLoginStartRequest",
  "OperatorLoginCompleteRequest",
  "Challenge",
  "RefreshRequest",
  "ActorIdentity",
  "TokenPair",
  "RecoveryResult",
  "ProvisionActorRoleRequest",
  "ActorRoleView",
  "ActorRoleSearchPage",
  "PasswordResetRequest",
  "SessionInfo",
]

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

function goFieldName(name) {
  return name
    .split(/(?=[A-Z])/)
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === "id") return "ID";
      if (normalized === "e164") return "E164";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

function goPropertyType(lines, optional, context) {
  const ref = valueAfter(lines, "$ref:", 10);
  if (ref) return refType(ref);

  const constant = valueAfter(lines, "const:", 10);
  if (constant !== null) return "string";

  const enumValue = valueAfter(lines, "enum:", 10);
  if (enumValue) return "string";

  const type = valueAfter(lines, "type:", 10);
  if (type === "string") {
    const format = valueAfter(lines, "format:", 10);
    if (format === "date-time") return optional ? "*time.Time" : "time.Time";
    return "string";
  }
  if (type === "integer" || type === "number") return "int";
  if (type === "boolean") return "bool";
  if (type === "array") {
    const itemsIndex = lines.findIndex((line) => line === "          items:");
    if (itemsIndex < 0) throw new Error(context + " array is missing items");
    const itemLines = lines.slice(itemsIndex + 1);
    const itemRef = valueAfter(itemLines, "$ref:", 12);
    if (itemRef) return "[]" + refType(itemRef);
    const itemType = valueAfter(itemLines, "type:", 12);
    if (itemType === "string") return "[]string";
    if (itemType === "integer" || itemType === "number") return "[]int";
    if (itemType === "boolean") return "[]bool";
  }
  throw new Error(context + " has unsupported Go property type");
}

function renderGoObject(name, lines) {
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

  const fields = starts.map((property, index) => {
    const next = starts[index + 1];
    const block = region.slice(property.index + 1, next ? next.index : region.length);
    const optional = !required.has(property.name);
    const type = goPropertyType(block, optional, name + "." + property.name);
    return "\t" + goFieldName(property.name) + " " + type + " `json:\"" + property.name + (optional ? ",omitempty" : "") + "\"`";
  });
  return "type " + name + " struct {\n" + fields.join("\n") + "\n}";
}

function generateGoTypes() {
  referencedSchemas.clear();
  const rendered = [];
  const aliases = new Set(["ActorType", "ManagedActorType", "ManagedActivationRole", "ControlPanelRole"]);
  for (const name of schemaNames) {
    const lines = findSchemaLines(name);
    const type = valueAfter(lines, "type:", 6);
    if (aliases.has(name)) rendered.push("type " + name + " = string;");
    else if (type === "object") rendered.push(renderGoObject(name, lines));
    else throw new Error(name + " has unsupported top-level Go schema type " + JSON.stringify(type));
  }
  const header = [
    "// Code generated by tools/dev/generate-identity-types.mjs; DO NOT EDIT.",
    "// Source: services/identity/contracts/identity.openapi.yaml.",
    "// Source Git blob SHA: " + sourceBlobSha,
    "",
    "package identityclient",
    "",
    "import \"time\"",
    "",
  ].join("\n");
  return header + rendered.join("\n\n") + "\n";
}

function formatGoTypes(sourceText) {
  const temporaryPath = goOutputPath + ".tmp";
  fs.writeFileSync(temporaryPath, sourceText, "utf8");
  try {
    execFileSync("gofmt", ["-w", temporaryPath]);
    return fs.readFileSync(temporaryPath, "utf8");
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function identityOperations() {
  const operations = [];
  let currentPath = null;
  let currentMethod = null;
  for (const line of sourceLines) {
    if (indentOf(line) === 2 && line.trim().startsWith("/") && line.trim().endsWith(":")) {
      currentPath = line.trim().slice(0, -1);
      currentMethod = null;
      continue;
    }
    const method = line.trim().match(/^(get|post|put|patch|delete):$/);
    if (indentOf(line) === 4 && method) {
      currentMethod = method[1].toUpperCase();
      continue;
    }
    if (currentPath && currentMethod && indentOf(line) === 6 && line.trim().startsWith("operationId:")) {
      operations.push({ operationId: line.trim().slice("operationId:".length).trim(), method: currentMethod, path: currentPath });
    }
  }
  if (operations.length === 0) throw new Error("OpenAPI operation closure is empty");
  const ids = new Set();
  for (const operation of operations) {
    if (ids.has(operation.operationId)) throw new Error("duplicate OpenAPI operationId " + operation.operationId);
    ids.add(operation.operationId);
  }
  return operations;
}

function operationConstName(operationId) {
  return operationId.charAt(0).toUpperCase() + operationId.slice(1);
}

function generateOperations() {
  const operations = identityOperations();
  const tsHeader = [
    "/**",
    " * AUTO-GENERATED from services/identity/contracts/identity.openapi.yaml.",
    " * Source Git blob SHA: " + sourceBlobSha,
    " * Generated by tools/dev/generate-identity-types.mjs. DO NOT EDIT.",
    " */",
    "",
    "export const identityOperationPaths = {",
  ];
  for (const operation of operations) {
    tsHeader.push("  " + operation.operationId + ": { method: " + JSON.stringify(operation.method) + ", path: " + JSON.stringify(operation.path) + " },");
  }
  tsHeader.push("} as const;", "");

  const goHeader = [
    "// Code generated by tools/dev/generate-identity-types.mjs; DO NOT EDIT.",
    "// Source: services/identity/contracts/identity.openapi.yaml.",
    "// Source Git blob SHA: " + sourceBlobSha,
    "",
    "package identityclient",
    "",
    "type IdentityOperation struct {",
    "\tMethod string",
    "\tPath   string",
    "}",
    "",
  ];
  for (const operation of operations) {
    goHeader.push("var IdentityOperation" + operationConstName(operation.operationId) + " = IdentityOperation{Method: " + JSON.stringify(operation.method) + ", Path: " + JSON.stringify(operation.path) + "}");
  }
  goHeader.push("");
  return { ts: tsHeader.join("\n"), go: goHeader.join("\n") };
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
const generatedGo = formatGoTypes(generateGoTypes());
const generatedOperations = generateOperations();
const generatedGoOperations = formatGoTypes(generatedOperations.go);
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  const currentOperations = fs.existsSync(operationsOutputPath) ? fs.readFileSync(operationsOutputPath, "utf8") : "";
  const currentGo = fs.existsSync(goOutputPath) ? fs.readFileSync(goOutputPath, "utf8") : "";
  const currentGoOperations = fs.existsSync(goOperationsOutputPath) ? fs.readFileSync(goOperationsOutputPath, "utf8") : "";
  if (current !== generated || currentOperations !== generatedOperations.ts || currentGo !== generatedGo || currentGoOperations !== generatedGoOperations) {
    console.error("IDENTITY_GENERATED_TYPES=DRIFT");
    process.exit(1);
  }
  console.log("IDENTITY_GENERATED_TYPES=PASS blob=" + sourceBlobSha);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated, "utf8");
  fs.writeFileSync(operationsOutputPath, generatedOperations.ts, "utf8");
  fs.writeFileSync(goOutputPath, generatedGo, "utf8");
  fs.writeFileSync(goOperationsOutputPath, generatedGoOperations, "utf8");
  console.log("IDENTITY_GENERATED_TYPES=WRITTEN blob=" + sourceBlobSha);
}
