// One owner contract admission boundary. Domain validation rules are kept
// separate from file admission and independent multi-owner execution.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { generatedOperationSource, generatedOperationsPath } from "./generate-openapi-operations.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const allowed = new Set(["identity", "dsh", "wlt"]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const relativeName = (base, file) => path.relative(base, file).replaceAll("\\", "/");

function ownerFiles(folder) {
  const files = [];
  function walk(directory) {
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink() ||
        path.relative(directory, realpathSync.native(directory)) !== "") {
      throw new Error("Unsafe owner contract directory: " + directory);
    }
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error("Linked owner contract entry: " + file);
      if (child.isDirectory()) walk(file);
      else if (/\.ya?ml$/.test(child.name)) {
        if (!child.isFile() || path.relative(file, realpathSync.native(file)) !== "") {
          throw new Error("Unsafe owner contract file: " + file);
        }
        files.push(file);
      }
    }
  }
  walk(folder);
  return files.sort();
}

// YAML aliases can form graphs, including actual cycles. Only finite JSON
// documents are admitted; shared acyclic aliases are inspected once.
function referencesIn(document) {
  const references = [];
  const active = new WeakSet();
  const seen = new WeakSet();
  const stack = [{ value: document, leaving: false }];
  while (stack.length) {
    const { value, leaving } = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (leaving) {
      active.delete(value);
      seen.add(value);
      continue;
    }
    if (active.has(value)) throw new Error("Cyclic YAML alias in owner contract");
    if (seen.has(value)) continue;
    active.add(value);
    stack.push({ value, leaving: true });
    if (Object.hasOwn(value, "$ref")) references.push(value.$ref);
    for (const child of Object.values(value).reverse()) stack.push({ value: child, leaving: false });
  }
  return references;
}

function loadDocuments(folder, base) {
  const documents = new Map();
  const references = new Map();
  const errors = [];
  let files;
  try {
    files = ownerFiles(folder);
  } catch (error) {
    errors.push("Owner contract inventory unavailable: " + error.message);
    return { documents, references, errors };
  }
  for (const file of files) {
    const name = relativeName(base, file);
    try {
      const document = YAML.parseDocument(readFileSync(file, "utf8"), {
        uniqueKeys: true, strict: true, prettyErrors: true,
      });
      if (document.errors.length) {
        for (const error of document.errors) errors.push(name + ": " + error.message);
        continue;
      }
      const value = document.toJS();
      if (!isObject(value)) throw new Error("OpenAPI YAML root must be an object");
      references.set(file, referencesIn(value));
      documents.set(file, value);
    } catch (error) {
      errors.push(name + ": " + error.message);
    }
  }
  return { documents, references, errors };
}

function validateContract(owner, base) {
  const folder = path.join(base, "services", owner, "contracts", "openapi");
  const mainFile = path.join(folder, owner + ".openapi.yaml");
  const { documents, references: referenced, errors } = loadDocuments(folder, base);
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
  for (const [file, values] of referenced) {
    references += values.length;
    for (const reference of values) resolveRef(file, reference);
  }

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
        (owner === "dsh" && operationId === "dshHealth") ||
        (owner === "wlt" && operationId === "getWltDevelopmentHealth");
    }
    if (owner === "dsh" && method === "get") {
      const admitted = {
        "/v1/public/cities": "listPublicCities",
        "/v1/public/verticals": "listPublicVerticals",
        "/v1/public/stores": "listPublicStores",
        "/v1/public/stores/{id}": "getPublicStore",
        "/v1/public/stores/{id}/offers": "listPublicOffers",
        "/v1/public/stores/{id}/offers/{offerId}/estimate": "estimatePublicOffer",
      };
      return Object.hasOwn(admitted, urlPath) && admitted[urlPath] === operationId;
    }
    // Public Captain interest is intake-only: DSH stores contact details without
    // creating an Identity actor or granting Captain standing. Operator reads
    // and contact writes remain bearer-protected.
    if (owner === "dsh" && method === "post" &&
        urlPath === "/v1/captain-interest" &&
        operationId === "submitPublicCaptainInterest") return true;
    if (owner === "identity" && method === "post") {
      const admitted = {
        "/v1/customer-auth/phone-challenges": "issueCustomerPhoneChallenge",
        "/v1/customer-auth/phone-verification": "verifyCustomerPhoneChallenge",
        "/v1/operators/passkey/authentication": "finishOperatorPasskeyAuthentication",
        "/v1/operators/passkey/authentication/options": "beginOperatorPasskeyAuthentication",
        // Offline-issued, expiring 256-bit proof authorizes these opt-in
        // synthetic enrollment ceremonies, never an implicit Operator role.
        "/v1/operators/passkey/bootstrap/options": "beginInitialOperatorPasskeyRegistration",
        "/v1/operators/passkey/bootstrap": "finishInitialOperatorPasskeyRegistration",
        // Recovery is proof-bound to an existing Operator by an independently
        // authorized Identity owner row, never a browser-selected actor.
        "/v1/operators/passkey/recovery/options": "beginExistingOperatorPasskeyRecovery",
        "/v1/operators/passkey/recovery": "finishExistingOperatorPasskeyRecovery",
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
  if (opaqueSession?.type !== "http" || opaqueSession?.scheme !== "bearer") {
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
        // The existing WLT development probe deliberately sends empty 200/503 bodies.
        // No other operation inherits this response exception.
        const bodylessWltHealth = owner === "wlt" && id === "getWltDevelopmentHealth" &&
          urlPath === "/health" && method === "get" &&
          (status === "200" || status === "503") && resolved?.content === undefined;
        if (/^2(?:[0-9]{2}|XX)$/.test(status) && status !== "204" && !bodylessWltHealth) {
          const schema = resolved?.content?.["application/json"]?.schema;
          if (!isObject(schema) && typeof schema !== "boolean") {
            errors.push("Missing successful JSON response schema: " + method + " " + urlPath + " " + status);
          }
        }
        const bodylessHealthValidation = owner === "identity" && id === "getIdentityDevelopmentHealth" &&
          urlPath === "/health" && method === "get" && status === "400" && resolved?.content === undefined;
        if (/^[45](?:[0-9]{2}|XX)$/.test(status) && !bodylessHealthValidation && !bodylessWltHealth &&
            !isObject(resolved?.content?.["application/json"]?.schema)) {
          errors.push("Missing JSON error response schema: " + method + " " + urlPath + " " + status);
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

  const generatedPath = generatedOperationsPath(owner, base);
  let generatedOperationParity = "NOT_RUN";
  let normalizedContractFingerprint = "NOT_RUN";
  if (existsSync(generatedPath)) {
    const generated = readFileSync(generatedPath, "utf8");
    const beforeParity = errors.length;
    if (beforeParity === 0) {
      try {
        if (generated !== generatedOperationSource(owner, base)) {
          normalizedContractFingerprint = "FAIL";
          errors.push("Generated operation manifest is not deterministic from current owner OpenAPI: " + owner);
        } else {
          normalizedContractFingerprint = "PASS";
        }
      } catch (error) {
        normalizedContractFingerprint = "FAIL";
        errors.push("Generated operation manifest cannot be derived: " + error.message);
      }
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
    generatedOperationParity = errors.length > beforeParity ? "FAIL" : beforeParity === 0 ? "PASS" : "NOT_RUN";
  } else if (path.resolve(base) === root) {
    generatedOperationParity = "FAIL";
    errors.push("Generated operation manifest missing for active owner: " + owner);
  }

  return { owner, files: documents.size, paths: pathCount, operations: operations.size, references,
    generatedOperationParity, normalizedContractFingerprint, errors };
}

export function validate(owner, base = root) {
  if (!allowed.has(owner)) throw new Error("Invalid service owner: " + owner);
  try {
    return validateContract(owner, path.resolve(base));
  } catch (error) {
    // Admission or parser failure is a failed owner, never a process-wide
    // interruption that hides independent owner outcomes.
    return { owner, errors: ["Owner contract validation failed: " + error.message] };
  }
}

export function validateOwners(owners, base = root) {
  if (!owners.length || new Set(owners).size !== owners.length || owners.some(owner => !allowed.has(owner))) {
    throw new Error("Specify one or more distinct service owners: identity, dsh, wlt");
  }
  return owners.map(owner => validate(owner, base));
}

export function run(owners, base = root, log = console) {
  let results;
  try {
    results = validateOwners(owners, base);
  } catch (error) {
    log.error(error.message);
    return 2;
  }
  for (const result of results) {
    const count = name => result[name] ?? "NOT_RUN";
    log.log("OPENAPI_" + result.owner.toUpperCase() + "=" + (result.errors.length ? "FAIL" : "PASS") +
      " files=" + count("files") + " paths=" + count("paths") +
      " operations=" + count("operations") + " refs=" + count("references") +
      " errors=" + result.errors.length +
      " generatedOperationParity=" + count("generatedOperationParity") +
      " normalizedContractFingerprint=" + count("normalizedContractFingerprint") +
      " fullGeneratedClientParity=NOT_RUN");
    for (const error of result.errors) log.error("  " + error);
  }
  return results.some(result => result.errors.length) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = run(process.argv.slice(2));
}
