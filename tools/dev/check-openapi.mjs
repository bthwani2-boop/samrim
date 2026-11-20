import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { generatedOperationSource } from "./generate-openapi-operations.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const allowed = new Set(["identity", "dsh", "wlt"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function readFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) return readFiles(absolute);
    return entry.isFile() && /\.ya?ml$/.test(entry.name) ? [absolute] : [];
  });
}

export function validate(owner, base = root) {
  if (!allowed.has(owner)) throw new Error("Invalid service owner: " + owner);
  const folder = path.join(base, "services", owner, "contracts", "openapi");
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
      errors.push(path.relative(base, file) + ": " + error.message);
    }
    if (document.errors.length === 0) documents.set(file, document.toJS());
  }
  if (errors.length) return { owner, errors };

  const entrypoint = documents.get(mainFile);
  if (!entrypoint || typeof entrypoint.openapi !== "string" || !/^3\.1\.\d+$/.test(entrypoint.openapi)) {
    errors.push("No OpenAPI 3.1 entrypoint: " + path.relative(base, mainFile));
    return { owner, errors };
  }

  function resolveRef(file, reference) {
    if (typeof reference !== "string" || reference.startsWith("http:") || reference.startsWith("https:")) {
      errors.push(path.relative(base, file) + ": unsupported $ref " + JSON.stringify(reference));
      return undefined;
    }
    const [relative, fragment] = reference.split("#", 2);
    const targetFile = relative ? path.resolve(path.dirname(file), relative) : file;
    if (!documents.has(targetFile)) {
      errors.push(path.relative(base, file) + ": missing $ref file " + reference);
      return undefined;
    }
    let object = documents.get(targetFile);
    if (fragment !== undefined) {
      if (!fragment.startsWith("/")) {
        errors.push(path.relative(base, file) + ": invalid JSON pointer in " + reference);
        return undefined;
      }
      for (const part of fragment.slice(1).split("/")) {
        const segment = part.replaceAll("~1", "/").replaceAll("~0", "~");
        if (object === null || typeof object !== "object" || !Object.hasOwn(object, segment)) {
          errors.push(path.relative(base, file) + ": unresolved $ref " + reference);
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
    if (Object.hasOwn(value, "$ref")) {
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
  const allowedHeaderKeys = new Set([
    "description", "required", "deprecated", "style", "explode", "schema", "example",
    "examples", "content", "$ref", "summary",
  ]);
  function validateObjectKeys(object, allowed, location) {
    if (!isObject(object)) {
      errors.push("Invalid OpenAPI object: " + location);
      return false;
    }
    for (const key of Object.keys(object)) {
      if (!allowed.has(key) && !key.startsWith("x-")) {
        errors.push("Unknown OpenAPI field " + key + " on " + location);
      }
    }
    return true;
  }
  function dereference(value, file, location) {
    const visited = new Set();
    while (isObject(value) && Object.hasOwn(value, "$ref")) {
      if (visited.has(value)) {
        errors.push("Cyclic OpenAPI object reference: " + location);
        return {};
      }
      visited.add(value);
      const reference = value.$ref;
      value = resolveRef(file, reference);
      if (typeof reference !== "string") break;
      const relative = reference.split("#")[0];
      if (relative) file = path.resolve(path.dirname(file), relative);
    }
    return { value, file };
  }
  function validateParameters(parameters, file, names, location) {
    const declared = new Set();
    const keys = new Set();
    if (parameters === undefined) return declared;
    if (!Array.isArray(parameters)) {
      errors.push("Invalid parameter list: " + location);
      return declared;
    }
    for (const [index, parameter] of parameters.entries()) {
      const label = location + "." + index;
      if (!validateObjectKeys(parameter, allowedParameterKeys, label)) continue;
      const { value } = dereference(parameter, file, label);
      if (typeof value?.name !== "string" || !value.name ||
          !["path", "query", "header", "cookie"].includes(value.in)) {
        errors.push("Invalid parameter name or location: " + label);
        continue;
      }
      const key = value.in + ":" + value.name;
      if (keys.has(key)) errors.push("Duplicate parameter " + key + ": " + location);
      keys.add(key);
      if (value.in !== "path") continue;
      if (!names.includes(value.name)) errors.push("Undeclared path parameter {" + value.name + "}: " + location);
      if (value.required !== true) errors.push("Path parameter must be required: " + label);
      else declared.add(value.name);
    }
    return declared;
  }
  function validateResponse(response, file, location) {
    if (!validateObjectKeys(response, allowedResponseKeys, location)) return undefined;
    const { value, file: responseFile } = dereference(response, file, location);
    if (typeof value?.description !== "string" || !value.description.trim()) {
      errors.push("Missing response description: " + location);
    }
    if (value?.headers !== undefined && !isObject(value.headers)) {
      errors.push("Invalid response headers: " + location);
      return value;
    }
    const headerNames = new Set();
    for (const [name, header] of Object.entries(value?.headers ?? {})) {
      const label = location + ".headers." + name;
      const normalized = name.toLowerCase();
      if (headerNames.has(normalized)) errors.push("Duplicate response header: " + label);
      headerNames.add(normalized);
      if (!validateObjectKeys(header, allowedHeaderKeys, label)) continue;
      const { value: resolvedHeader } = dereference(header, responseFile, label);
      if (!isObject(resolvedHeader) ||
          Object.hasOwn(resolvedHeader, "schema") === Object.hasOwn(resolvedHeader, "content")) {
        errors.push("Missing response header schema or content (exactly one required): " + label);
      }
    }
    return value;
  }
  for (const [name, response] of Object.entries(entrypoint.components?.responses ?? {})) {
    validateObjectKeys(response, allowedResponseKeys, "components.responses." + name);
  }
  for (const [name, parameter] of Object.entries(entrypoint.components?.parameters ?? {})) {
    validateObjectKeys(parameter, allowedParameterKeys, "components.parameters." + name);
  }

  // Public admission is a security-sensitive boundary, not a substitute for
  // each owner's declared permissions. Unknown/new routes remain protected
  // until their owner contract and tests explicitly admit them.
  function isOwnerPublicOperation(urlPath, method, operationId) {
    // Explicit owner admission matches the entire operation identity, not a
    // pathname prefix or a recycled public route with a different handler.
    if (urlPath === "/health" && method === "get") {
      return (owner === "identity" && operationId === "getIdentityDevelopmentHealth") ||
        (owner === "dsh" && operationId === "dshHealth");
    }
    if (owner === "dsh" && method === "get") {
      const admitted = {
        "/v1/public/verticals": "listPublicVerticals",
        "/v1/public/stores": "listPublicStores",
        "/v1/public/stores/{id}": "getPublicStore",
        "/v1/public/stores/{id}/offers": "listPublicOffers",
      };
      return Object.hasOwn(admitted, urlPath) && admitted[urlPath] === operationId;
    }
    if (owner === "identity" && method === "post") {
      const admitted = {
        "/v1/customer-auth/phone-challenges": "issueCustomerPhoneChallenge",
        "/v1/customer-auth/phone-verification": "verifyCustomerPhoneChallenge",
        "/v1/operators/passkey/authentication": "finishOperatorPasskeyAuthentication",
        "/v1/operators/passkey/authentication/options": "beginOperatorPasskeyAuthentication",
      };
      return Object.hasOwn(admitted, urlPath) && admitted[urlPath] === operationId;
    }
    return false;
  }

  const supportedMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  const allowedPathItemKeys = new Set([...supportedMethods, "$ref", "summary", "description", "servers", "parameters"]);
  const schemeNames = new Set(Object.keys(entrypoint.components?.securitySchemes ?? {}));
  const opaqueSession = entrypoint.components?.securitySchemes?.OpaqueSession;
  // A declared name alone cannot prove that clients use Identity's bearer
  // credential; an API key or Basic scheme would silently change auth behavior.
  if ((owner !== "wlt" || opaqueSession !== undefined) &&
      (opaqueSession?.type !== "http" || opaqueSession?.scheme !== "bearer")) {
    errors.push("OpaqueSession must be HTTP bearer in " + owner);
  }
  const operations = new Map();
  const templates = new Set();
  const usedModules = new Set();
  let pathCount = 0;
  if (!isObject(entrypoint.paths)) {
    errors.push("Invalid OpenAPI paths map: " + owner);
    return { owner, errors };
  }

  for (const [urlPath, rawItem] of Object.entries(entrypoint.paths)) {
    pathCount++;
    if (!urlPath.startsWith("/")) errors.push("Invalid path: " + urlPath);
    const names = [...urlPath.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    const template = urlPath.replace(/\{[^{}]+\}/g, "{}");
    if (templates.has(template)) errors.push("Equivalent OpenAPI path templates: " + urlPath);
    templates.add(template);
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem) ||
        !Object.hasOwn(rawItem, "$ref")) {
      errors.push("Owner PathItem must reference path module: " + urlPath);
      continue;
    }
    for (const key of Object.keys(rawItem)) {
      if (key !== "$ref" && key !== "summary" && key !== "description") {
        errors.push("Unsupported PathItem reference sibling " + key + " on " + urlPath);
      }
    }
    let item = rawItem;
    let sourceFile = mainFile;
    if (rawItem?.$ref !== undefined) {
      if (typeof rawItem.$ref !== "string" || rawItem.$ref.length === 0) {
        errors.push("Invalid PathItem $ref on " + urlPath);
        continue;
      }
      item = resolveRef(mainFile, rawItem.$ref);
      sourceFile = path.resolve(path.dirname(mainFile), rawItem.$ref.split("#")[0]);
      usedModules.add(sourceFile);
      const pathPointer = "/paths/" + urlPath.replaceAll("~", "~0").replaceAll("/", "~1");
      if (rawItem.$ref.split("#")[1] !== pathPointer) {
        errors.push("PathItem reference does not match declared path: " + urlPath);
      }
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push("Missing PathItem: " + urlPath);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (!allowedPathItemKeys.has(key) && !key.startsWith("x-")) {
        errors.push("Unknown PathItem field " + key + " on " + urlPath);
      }
    }
    const inherited = validateParameters(item.parameters, sourceFile, names, urlPath + " parameters");
    let methods = 0;
    for (const [method, operation] of Object.entries(item)) {
      if (!supportedMethods.has(method)) continue;
      methods++;
      if (!isObject(operation)) {
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
      const responses = isObject(operation.responses) ? operation.responses : {};
      if (Object.keys(responses).length === 0) {
        errors.push("Missing responses: " + method + " " + urlPath);
      }
      if (!Object.keys(responses).some((status) => /^2(?:[0-9]{2}|XX)$/.test(status))) {
        errors.push("No successful response: " + method + " " + urlPath);
      }
      if (!isOwnerPublicOperation(urlPath, method, id) && !Object.hasOwn(responses, "401")) {
        errors.push("Protected operation missing 401 response: " + method + " " + urlPath);
      }
      for (const [status, response] of Object.entries(responses)) {
        if (!/^(?:default|[1-5][0-9]{2}|[1-5]XX)$/.test(status)) {
          errors.push("Invalid HTTP response status " + status + " on " + method + " " + urlPath);
        }
        const resolved = validateResponse(response, sourceFile, method + " " + urlPath + " responses." + status);
        if (/^2(?:[0-9]{2}|XX)$/.test(status) && status !== "204" &&
            !(owner === "identity" && urlPath === "/health")) {
          const schema = resolved?.content?.["application/json"]?.schema;
          if (!isObject(schema) && typeof schema !== "boolean") {
            errors.push("Missing successful JSON response schema: " + method + " " + urlPath + " " + status);
          }
        }
      }
      const declared = validateParameters(operation.parameters, sourceFile, names, method + " " + urlPath + " parameters");
      for (const name of names) {
        if (!inherited.has(name) && !declared.has(name)) {
          errors.push("Missing required path parameter {" + name + "} in " + method + " " + urlPath);
        }
      }
      if (!Object.hasOwn(operation, "security")) {
        errors.push("Missing explicit operation security: " + method + " " + urlPath);
      } else if (!Array.isArray(operation.security)) {
        errors.push("Invalid operation security: " + method + " " + urlPath);
      } else {
        const publiclyAdmitted = isOwnerPublicOperation(urlPath, method, id);
        if (publiclyAdmitted && operation.security.length !== 0) {
          errors.push("Public operation must not require OpaqueSession: " + method + " " + urlPath);
        }
        if (!publiclyAdmitted && !(
          operation.security.length === 1 &&
          Object.keys(operation.security[0] ?? {}).length === 1 &&
          Array.isArray(operation.security[0]?.OpaqueSession) &&
          operation.security[0].OpaqueSession.length === 0
        )) {
          errors.push("Protected operation must require OpaqueSession: " + method + " " + urlPath);
        }
        for (const security of operation.security) {
          if (!security || typeof security !== "object" || Array.isArray(security) || Object.keys(security).length === 0) {
            errors.push("Invalid operation security: " + method + " " + urlPath);
            continue;
          }
          for (const [name, scopes] of Object.entries(security)) {
            if (!schemeNames.has(name)) errors.push("Unknown security scheme " + name + " on " + method + " " + urlPath);
            if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
              errors.push("Invalid security scheme scopes " + name + " on " + method + " " + urlPath);
            }
          }
        }
      }
      if (operation.deprecated && method !== "get" && !Object.keys(responses).some((code) => /^4\d\d$/.test(code))) {
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
        errors.push("Unlinked path in " + path.relative(base, file) + ": " + urlPath);
      } else if (path.resolve(path.dirname(mainFile), pathRef.split("#")[0]) !== file) {
        errors.push("Wrong path-module owner for " + urlPath);
      }
    }
    if (document.paths && Object.keys(document.paths).length && !usedModules.has(file)) {
      errors.push("Unreferenced path module: " + path.relative(base, file));
    }
  }

  if (owner !== "wlt" && existsSync(path.join(base, "services", owner, "clients", "generated", owner + "-operations.ts"))) {
    const generatedPath = path.join(base, "services", owner, "clients", "generated", owner + "-operations.ts");
    const generated = readFileSync(generatedPath, "utf8");
    if (path.resolve(base) === root && generated !== generatedOperationSource(owner, base)) {
      errors.push("Generated operation manifest is not deterministic from current owner OpenAPI: " + owner);
    }
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
  } else if (owner !== "wlt" && path.resolve(base) === root) {
    errors.push("Generated operation manifest missing for active owner: " + owner);
  }

  return { owner, files: documents.size, paths: pathCount, operations: operations.size, references, errors };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const owners = process.argv.slice(2);
  if (owners.length === 0 || owners.some((owner) => !allowed.has(owner))) {
    console.error("Usage: node tools/dev/check-openapi.mjs identity|dsh|wlt [more owners]");
    process.exitCode = 2;
  } else {
    let failed = false;
    for (const owner of owners) {
      const result = validate(owner);
      if (result.errors.length) failed = true;
      console.log("OPENAPI_" + owner.toUpperCase() + "=" + (result.errors.length ? "FAIL" : "PASS") +
        " files=" + result.files + " paths=" + result.paths + " operations=" + result.operations +
        " refs=" + result.references + " errors=" + result.errors.length +
        " generatedOperationParity=" + (owner === "wlt" ? "NOT_RUN" :
          existsSync(path.join(root, "services", owner, "clients", "generated", owner + "-operations.ts")) ? "CHECKED" : "NOT_RUN") +
        " fullGeneratedClientParity=NOT_RUN");
      for (const error of result.errors.slice(0, 40)) console.error("  " + error);
    }
    if (failed) process.exitCode = 1;
  }
}
