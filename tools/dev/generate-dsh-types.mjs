import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "services/dsh/contracts/dsh.openapi.yaml");
const outputPath = path.join(root, "apps/control-panel/lib/generated/dsh-types.ts");
const operationsOutputPath = path.join(root, "apps/control-panel/lib/generated/dsh-operations.ts");

const source = fs.readFileSync(contractPath, "utf8");
const sourceBlobSha = crypto
  .createHash("sha1")
  .update("blob " + Buffer.byteLength(source, "utf8") + "\0" + source)
  .digest("hex");

const sourceLines = source.split("\n");

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function dshOperations() {
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
  if (operations.length === 0) throw new Error("DSH OpenAPI operation closure is empty");
  return operations;
}

function findSchemaLines(name) {
  const marker = "    " + name + ":";
  const start = sourceLines.findIndex((line) => line === marker);
  if (start < 0) throw new Error("missing OpenAPI schema " + name);

  let end = sourceLines.length;
  for (let index = start + 1; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    if (indentOf(line) <= 4 && /^[A-Za-z0-9_]+:$/.test(line.trim())) {
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
  return match[1];
}

function propertyType(lines, context) {
  const nullable = valueAfter(lines, "nullable:", 10) === "true";
  let rendered = "";

  const ref = valueAfter(lines, "$ref:", 10);
  if (ref) {
    rendered = refType(ref);
  } else {
    const constant = valueAfter(lines, "const:", 10);
    if (constant !== null) {
      rendered = literal(constant);
    } else {
      const enumValue = valueAfter(lines, "enum:", 10);
      if (enumValue) {
        rendered = inlineEnum(enumValue);
      } else {
        const type = valueAfter(lines, "type:", 10);
        switch (type) {
          case "string":
            rendered = "string";
            break;
          case "integer":
          case "number":
            rendered = "number";
            break;
          case "boolean":
            rendered = "boolean";
            break;
          case "array": {
            const itemsIndex = lines.findIndex((line) => line === "          items:");
            if (itemsIndex < 0) throw new Error(context + " array is missing items");
            const itemLines = lines.slice(itemsIndex + 1);
            const itemRef = valueAfter(itemLines, "$ref:", 12);
            if (itemRef) {
              rendered = "ReadonlyArray<" + refType(itemRef) + ">";
            } else {
              const itemType = valueAfter(itemLines, "type:", 12);
              if (itemType === "string") rendered = "ReadonlyArray<string>";
              else if (itemType === "integer" || itemType === "number") rendered = "ReadonlyArray<number>";
              else if (itemType === "boolean") rendered = "ReadonlyArray<boolean>";
              else throw new Error(context + " has unsupported array item type");
            }
            break;
          }
          case "object": {
            const propsIndex = lines.findIndex((line) => line.trim() === "properties:");
            if (propsIndex >= 0) {
              const reqValue = valueAfter(lines, "required:", 12);
              const req = new Set();
              if (reqValue) {
                const match = reqValue.match(/^\[([^\]]*)\]$/);
                if (match) {
                  for (const part of match[1].split(",").map((p) => p.trim()).filter(Boolean)) req.add(part);
                }
              }
              const objRegion = lines.slice(propsIndex + 1);
              const objStarts = [];
              for (let i = 0; i < objRegion.length; i++) {
                const l = objRegion[i];
                if (indentOf(l) === 14 && /^[A-Za-z0-9_]+:$/.test(l.trim())) {
                  objStarts.push({ index: i, name: l.trim().slice(0, -1) });
                }
              }
              if (objStarts.length > 0) {
                const objRendered = objStarts.map((p, i) => {
                  const nextP = objStarts[i + 1];
                  const blk = objRegion.slice(p.index + 1, nextP ? nextP.index : objRegion.length);
                  const opt = req.has(p.name) ? "" : "?";
                  const innerType = valueAfter(blk, "type:", 16) || "string";
                  return "readonly " + p.name + opt + ": " + innerType;
                });
                rendered = "{\n    " + objRendered.join(";\n    ") + ";\n  }";
                break;
              }
            }
            const additionalIndex = lines.findIndex((line) => line.includes("additionalProperties:"));
            if (additionalIndex >= 0) {
              const valueLines = lines.slice(additionalIndex + 1);
              const valueType = valueAfter(valueLines, "type:", 12);
              if (valueType === "string") rendered = "Readonly<Record<string, string>>";
              else if (valueType === "boolean") rendered = "Readonly<Record<string, boolean>>";
              else if (valueType === "integer" || valueType === "number") rendered = "Readonly<Record<string, number>>";
              else rendered = "Readonly<Record<string, unknown>>";
              break;
            }
            rendered = "Readonly<Record<string, unknown>>";
            break;
          }
          default:
            throw new Error(context + " has unsupported property type " + JSON.stringify(type));
        }
      }
    }
  }
  return nullable ? rendered + " | null" : rendered;
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

function extractSchemaNames() {
  const schemasIndex = sourceLines.findIndex((line) => line === "  schemas:");
  if (schemasIndex < 0) throw new Error("components.schemas not found");
  const names = [];
  for (let i = schemasIndex + 1; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    if (indentOf(line) === 4 && /^[A-Za-z0-9_]+:$/.test(line.trim())) {
      names.push(line.trim().slice(0, -1));
    } else if (indentOf(line) < 4 && line.trim() !== "") {
      break;
    }
  }
  return names;
}

function generateOperations() {
  const operations = dshOperations();
  const tsHeader = [
    "/**",
    " * AUTO-GENERATED from services/dsh/contracts/dsh.openapi.yaml.",
    " * Source Git blob SHA: " + sourceBlobSha,
    " * Generated by tools/dev/generate-dsh-types.mjs. DO NOT EDIT.",
    " */",
    "",
    "export const dshOperationPaths = {",
  ];
  for (const operation of operations) {
    tsHeader.push("  " + operation.operationId + ": { method: " + JSON.stringify(operation.method) + ", path: " + JSON.stringify(operation.path) + " },");
  }
  tsHeader.push("} as const;", "");
  return tsHeader.join("\n");
}

function generateTypes() {
  const schemaNames = extractSchemaNames();
  const chunks = [
    "/**",
    " * AUTO-GENERATED from services/dsh/contracts/dsh.openapi.yaml.",
    " * Source Git blob SHA: " + sourceBlobSha,
    " * Generated by tools/dev/generate-dsh-types.mjs. DO NOT EDIT.",
    " */",
    "",
  ];

  for (const name of schemaNames) {
    chunks.push(renderSchema(name));
    chunks.push("");
    if (name === "StatusResponse") {
      chunks.push("export type DshStatusResponse = StatusResponse;");
      chunks.push("");
    }
  }

  return chunks.join("\n");
}

const generatedTypes = generateTypes();
const generatedOps = generateOperations();

if (process.argv.includes("--check")) {
  const currentTypes = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  const currentOps = fs.existsSync(operationsOutputPath) ? fs.readFileSync(operationsOutputPath, "utf8") : "";
  if (currentTypes !== generatedTypes || currentOps !== generatedOps) {
    console.error("DSH_GENERATED_TYPES=DRIFT");
    process.exit(1);
  }
  console.log("DSH_GENERATED_TYPES=PASS blob=" + sourceBlobSha);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generatedTypes, "utf8");
  fs.writeFileSync(operationsOutputPath, generatedOps, "utf8");
  console.log("DSH_GENERATED_TYPES=WRITTEN blob=" + sourceBlobSha);
}

