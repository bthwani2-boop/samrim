import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "../..");
const owners = process.argv.slice(2);
const allowed = new Set(["identity", "dsh", "wlt"]);
if (owners.length === 0 || owners.some((owner) => !allowed.has(owner))) {
  console.error("Usage: node tools/dev/check-openapi.mjs identity|dsh|wlt [more owners]");
  process.exit(2);
}

function readFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) return readFiles(absolute);
    return entry.isFile() && /\.ya?ml$/.test(entry.name) ? [absolute] : [];
  });
}

function validate(owner) {
  const folder = path.join(root, "services", owner, "contracts", "openapi");
  const mainFile = path.join(folder, owner + ".openapi.yaml");
  const documents = new Map();
  const errors = [];

  for (const file of readFiles(folder)) {
    const document = YAML.parseDocument(readFileSync(file, "utf8"), {
      uniqueKeys: true,
      strict: true,
      prettyErrors: true,
    });
    for (const error of document.errors) {
      errors.push(path.relative(root, file) + ": " + error.message);
    }
    if (document.errors.length === 0) documents.set(file, document.toJS());
  }
  if (errors.length) return { owner, errors };

  const entrypoint = documents.get(mainFile);
  if (!entrypoint || !entrypoint.openapi?.startsWith("3.")) {
    errors.push("No OpenAPI 3.x entrypoint: " + path.relative(root, mainFile));
    return { owner, errors };
  }

  function resolveRef(file, reference) {
    if (typeof reference !== "string" || reference.startsWith("http:") || reference.startsWith("https:")) {
      errors.push(path.relative(root, file) + ": unsupported $ref " + JSON.stringify(reference));
      return undefined;
    }
    const [relative, fragment] = reference.split("#", 2);
    const targetFile = relative ? path.resolve(path.dirname(file), relative) : file;
    if (!documents.has(targetFile)) {
      errors.push(path.relative(root, file) + ": missing $ref file " + reference);
      return undefined;
    }
    let object = documents.get(targetFile);
    if (fragment !== undefined) {
      if (!fragment.startsWith("/")) {
        errors.push(path.relative(root, file) + ": invalid JSON pointer in " + reference);
        return undefined;
      }
      for (const part of fragment.slice(1).split("/")) {
        const segment = part.replaceAll("~1", "/").replaceAll("~0", "~");
        if (object === null || typeof object !== "object" || !(segment in object)) {
          errors.push(path.relative(root, file) + ": unresolved $ref " + reference);
          return undefined;
        }
        object = object[segment];
      }
    }
    return object;
  }

  let references = 0;
  function visit(value, file) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, file);
      return;
    }
    if (typeof value.$ref === "string") {
      references++;
      resolveRef(file, value.$ref);
    }
    for (const child of Object.values(value)) visit(child, file);
  }
  for (const [file, document] of documents) visit(document, file);

  const allowedResponseKeys = new Set(["description", "headers", "content", "links", "$ref", "summary"]);
  const allowedParameterKeys = new Set([
    "name", "in", "description", "required", "deprecated", "allowEmptyValue", "style",
    "explode", "allowReserved", "schema", "example", "examples", "content", "$ref", "summary",
  ]);
  function validateObjectKeys(object, allowed, location) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      errors.push("Invalid OpenAPI object: " + location);
      return;
    }
    for (const key of Object.keys(object)) {
      if (!allowed.has(key) && !key.startsWith("x-")) {
        errors.push("Unknown OpenAPI field " + key + " on " + location);
      }
    }
  }
  for (const [name, response] of Object.entries(entrypoint.components?.responses ?? {})) {
    validateObjectKeys(response, allowedResponseKeys, "components.responses." + name);
  }
  for (const [name, parameter] of Object.entries(entrypoint.components?.parameters ?? {})) {
    validateObjectKeys(parameter, allowedParameterKeys, "components.parameters." + name);
  }

  const supportedMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  const schemeNames = new Set(Object.keys(entrypoint.components?.securitySchemes ?? {}));
  const operations = new Map();
  const usedModules = new Set();
  let pathCount = 0;

  for (const [urlPath, rawItem] of Object.entries(entrypoint.paths ?? {})) {
    pathCount++;
    if (!urlPath.startsWith("/")) errors.push("Invalid path: " + urlPath);
    let item = rawItem;
    let sourceFile = mainFile;
    if (rawItem?.$ref) {
      item = resolveRef(mainFile, rawItem.$ref);
      sourceFile = path.resolve(path.dirname(mainFile), rawItem.$ref.split("#")[0]);
      usedModules.add(sourceFile);
    }
    if (!item || typeof item !== "object") {
      errors.push("Missing PathItem: " + urlPath);
      continue;
    }
    let methods = 0;
    for (const [method, operation] of Object.entries(item)) {
      if (!supportedMethods.has(method)) continue;
      methods++;
      if (!operation || typeof operation !== "object") {
        errors.push("Invalid operation " + method + " " + urlPath);
        continue;
      }
      const id = operation.operationId;
      if (typeof id !== "string" || !id) {
        errors.push("Missing operationId: " + method + " " + urlPath);
      } else if (operations.has(id)) {
        errors.push("Duplicate operationId: " + id);
      } else {
        operations.set(id, { method: method.toUpperCase(), path: urlPath });
      }
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        errors.push("Missing responses: " + method + " " + urlPath);
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        validateObjectKeys(response, allowedResponseKeys, method + " " + urlPath + " responses." + status);
      }
      for (const [index, parameter] of (item.parameters ?? []).entries()) {
        validateObjectKeys(parameter, allowedParameterKeys, method + " " + urlPath + " pathParameters." + index);
      }
      for (const [index, parameter] of (operation.parameters ?? []).entries()) {
        validateObjectKeys(parameter, allowedParameterKeys, method + " " + urlPath + " parameters." + index);
      }
      const declaredParameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map((parameter) => (
        parameter.$ref ? resolveRef(sourceFile, parameter.$ref) : parameter
      ));
      for (const match of urlPath.matchAll(/\{([^}]+)\}/g)) {
        const name = match[1];
        if (!declaredParameters.some((parameter) => (
          parameter?.name === name && parameter.in === "path" && parameter.required === true
        ))) {
          errors.push("Missing required path parameter {" + name + "} in " + method + " " + urlPath);
        }
      }
      for (const security of operation.security ?? entrypoint.security ?? []) {
        for (const name of Object.keys(security)) {
          if (!schemeNames.has(name)) errors.push("Unknown security scheme " + name + " on " + method + " " + urlPath);
        }
      }
      if (operation.deprecated && method !== "get" && !Object.keys(operation.responses ?? {}).some((code) => /^4\d\d$/.test(code))) {
        errors.push("Retired mutation has no explicit refusal response: " + method + " " + urlPath);
      }
    }
    if (methods === 0) errors.push("Path has no HTTP operation: " + urlPath);
  }

  for (const [file, document] of documents) {
    if (file === mainFile) continue;
    for (const urlPath of Object.keys(document.paths ?? {})) {
      const pathRef = entrypoint.paths?.[urlPath]?.$ref;
      if (typeof pathRef !== "string") {
        errors.push("Unlinked path in " + path.relative(root, file) + ": " + urlPath);
      } else if (path.resolve(path.dirname(mainFile), pathRef.split("#")[0]) !== file) {
        errors.push("Wrong path-module owner for " + urlPath);
      }
    }
    if (document.paths && !usedModules.has(file)) {
      errors.push("Unreferenced path module: " + path.relative(root, file));
    }
  }

  if (owner !== "wlt") {
    const generatedPath = path.join(root, "services", owner, "clients", "generated", owner + "-operations.ts");
    const generated = readFileSync(generatedPath, "utf8");
    const generatedIds = new Map();
    const matcher = /^\s{2}([A-Za-z][A-Za-z0-9_]*): \{ method: "([A-Z]+)", path: "([^"]+)" \},$/gm;
    for (const match of generated.matchAll(matcher)) {
      if (generatedIds.has(match[1])) errors.push("Duplicate generated operation: " + match[1]);
      generatedIds.set(match[1], { method: match[2], path: match[3] });
    }
    for (const [id, expected] of operations) {
      const actual = generatedIds.get(id);
      if (!actual || actual.method !== expected.method || actual.path !== expected.path) {
        errors.push("Generated operation mismatch: " + id + " expects " + expected.method + " " + expected.path);
      }
    }
    for (const id of generatedIds.keys()) {
      if (!operations.has(id)) errors.push("Generated operation not in OpenAPI: " + id);
    }
  }

  return { owner, files: documents.size, paths: pathCount, operations: operations.size, references, errors };
}

let failed = false;
for (const owner of owners) {
  const result = validate(owner);
  if (result.errors.length > 0) failed = true;
  console.log("OPENAPI_" + owner.toUpperCase() + "=" + (result.errors.length ? "FAIL" : "PASS") +
    " files=" + result.files + " paths=" + result.paths + " operations=" + result.operations +
    " refs=" + result.references + " errors=" + result.errors.length);
  for (const error of result.errors.slice(0, 40)) console.error("  " + error);
  if (result.errors.length > 40) console.error("  ... " + (result.errors.length - 40) + " more errors");
}
if (failed) process.exitCode = 1;
