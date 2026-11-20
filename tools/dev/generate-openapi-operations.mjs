#!/usr/bin/env node
// Deterministic owner-operation index generated solely from executable owner OpenAPI.
// This is transport metadata, not a second DTO, permission, or business-policy owner.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const owners = new Set(["identity", "dsh", "wlt"]);
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

export function operationRows(owner, base = root) {
  if (!owners.has(owner)) throw new Error("Unsupported executable owner: " + owner);
  const folder = path.join(base, "services", owner, "contracts", "openapi");
  const main = YAML.parse(readFileSync(path.join(folder, owner + ".openapi.yaml"), "utf8"), { uniqueKeys: true });
  const result = [];
  const seen = new Set();
  for (const [route, pathItem] of Object.entries(main.paths ?? {})) {
    const ref = pathItem?.$ref;
    if (typeof ref !== "string" || !ref.startsWith("./paths/") || ref.split("#").length !== 2) {
      throw new Error("Unresolved owner path reference: " + route);
    }
    const [file, pointer] = ref.split("#");
    const filename = path.resolve(folder, file);
    if (path.dirname(filename) !== path.join(folder, "paths") || !filename.endsWith(".yaml")) {
      throw new Error("Path fragment outside canonical owner: " + route);
    }
    const fragment = YAML.parse(readFileSync(filename, "utf8"), { uniqueKeys: true });
    let operationGroup = fragment;
    for (const raw of pointer.slice(1).split("/").filter(Boolean)) {
      const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!operationGroup || !Object.hasOwn(operationGroup, key)) {
        throw new Error("Missing path fragment: " + route);
      }
      operationGroup = operationGroup[key];
    }
    for (const [method, operation] of Object.entries(operationGroup)) {
      if (!methods.has(method)) continue;
      const id = operation?.operationId;
      if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(id) || seen.has(id)) {
        throw new Error("Missing, duplicate or unsafe operationId: " + String(id));
      }
      seen.add(id);
      result.push({ id, method: method.toUpperCase(), path: route });
    }
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function generatedOperationSource(owner, base = root) {
  const rows = operationRows(owner, base);
  const property = owner + "Operations";
  return [
    "// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs",
    "// Owner contract is services/" + owner + "/contracts/openapi/" + owner + ".openapi.yaml.",
    "// Method/path metadata only; runtime schemas, authorization and errors remain owner contracts.",
    "export const " + property + " = {",
    ...rows.map(row => "  " + row.id + ": { method: " + JSON.stringify(row.method) +
      ", path: " + JSON.stringify(row.path) + " },"),
    "} as const;",
    "",
  ].join("\n");
}

export function generatedOperationsPath(owner, base = root) {
  return path.join(base, "services", owner, "clients", "generated", owner + "-operations.ts");
}

function run() {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const selected = check ? args.slice(1) : args;
  if (selected.length && selected.some(owner => !owners.has(owner))) {
    throw new Error("Usage: node tools/dev/generate-openapi-operations.mjs [--check] [identity|dsh|wlt ...]");
  }
  for (const owner of selected.length ? selected : owners) {
    const expected = generatedOperationSource(owner);
    const filename = generatedOperationsPath(owner);
    if (check) {
      if (!existsSync(filename) || readFileSync(filename, "utf8") !== expected) {
        throw new Error("GENERATED_OWNER_OPERATIONS_DRIFT: " + owner +
          " (regenerate and review the contract-derived diff)");
      }
      console.log("GENERATED_OWNER_OPERATIONS_PASS owner=" + owner +
        " operations=" + operationRows(owner).length);
    } else {
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, expected, "utf8");
      console.log("GENERATED_OWNER_OPERATIONS_WRITE owner=" + owner +
        " operations=" + operationRows(owner).length);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
