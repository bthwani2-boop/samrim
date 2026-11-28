import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { run, validate, validateOwners } from "./check-openapi.mjs";
import { generatedOperationSource, generatedOperationsPath } from "./generate-openapi-operations.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const owners = ["identity", "dsh", "wlt"];
function fixture(callback) {
  const base = mkdtempSync(path.join(tmpdir(), "bthwani-contract-admission-"));
  try {
    for (const owner of owners) {
      const relative = path.join("services", owner, "contracts", "openapi");
      cpSync(path.join(root, relative), path.join(base, relative), { recursive: true });
      const generated = generatedOperationsPath(owner, base);
      mkdirSync(path.dirname(generated), { recursive: true });
      writeFileSync(generated, generatedOperationSource(owner, base));
    }
    return callback(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
const ownerDir = (base, owner) => path.join(base, "services", owner, "contracts", "openapi");
function execute(owners, base) {
  const messages = [], errors = [];
  const exit = run(owners, base, { log: line => messages.push(line), error: line => errors.push(line) });
  return { exit, messages, errors };
}

test("complete owner contract execution proves deterministic parity for every valid owner", () => fixture(base => {
  const result = execute(owners, base);
  assert.equal(result.exit, 0, result.errors.join("\n"));
  assert.equal(result.messages.length, 3);
  for (const owner of owners) {
    const message = result.messages.find(line => line.startsWith("OPENAPI_" + owner.toUpperCase()));
    assert.match(message, /=PASS /);
    assert.match(message, /generatedOperationParity=PASS normalizedContractFingerprint=PASS/);
    assert.match(message, /fullGeneratedClientParity=NOT_RUN/);
  }
}));

test("missing source, null YAML and cyclic YAML reject their owners independently", () => fixture(base => {
  rmSync(ownerDir(base, "identity"), { recursive: true });
  writeFileSync(path.join(ownerDir(base, "dsh"), "invalid.yaml"), "null\n");
  writeFileSync(path.join(ownerDir(base, "wlt"), "recursive.yaml"), "recursive: &self { child: *self }\n");
  const results = validateOwners(owners, base);
  assert.equal(results.length, 3);
  assert.match(results[0].errors.join("\n"), /Owner contract inventory unavailable/);
  assert.match(results[1].errors.join("\n"), /YAML root must be an object/);
  assert.match(results[2].errors.join("\n"), /Cyclic YAML alias/);
  const result = execute(owners, base);
  assert.equal(result.exit, 1);
  assert.equal(result.messages.length, 3);
  for (const message of result.messages) {
    assert.match(message, /=FAIL /);
    assert.match(message, /generatedOperationParity=NOT_RUN normalizedContractFingerprint=NOT_RUN/);
    assert.doesNotMatch(message, /undefined/);
  }
}));

test("an invalid first owner does not hide subsequent successful owner evidence", () => fixture(base => {
  writeFileSync(path.join(ownerDir(base, "identity"), "invalid.yaml"), "null\n");
  const result = execute(owners, base);
  assert.equal(result.exit, 1);
  assert.match(result.messages[0], /OPENAPI_IDENTITY=FAIL/);
  assert.match(result.messages[1], /OPENAPI_DSH=PASS/);
  assert.match(result.messages[2], /OPENAPI_WLT=PASS/);
  assert.equal(execute(["dsh", "dsh"], base).exit, 2);
  assert.equal(execute([], base).exit, 2);
}));

test("linked contract fragments cannot disappear from the owner inventory", t => fixture(base => {
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "hidden.yaml"), "null\n");
  try {
    symlinkSync(outside, path.join(ownerDir(base, "identity"), "linked"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("links unavailable");
    throw error;
  }
  assert.match(validate("identity", base).errors.join("\n"), /Linked owner contract entry/);
}));

test("malformed URI fragments cannot be truncated into valid owner references", () => fixture(base => {
  const dir = ownerDir(base, "identity");
  for (const [index, reference] of [
    "identity.openapi.yaml#/info#unexpected",
    "identity.openapi.yaml#/info~2",
    "identity.openapi.yaml#/info%ZZ",
  ].entries()) {
    writeFileSync(path.join(dir, "probe-" + index + ".yaml"), "probe: { $ref: " + JSON.stringify(reference) + " }\n");
  }
  const result = validate("identity", base);
  assert.equal(result.errors.filter(message => message.includes("invalid JSON pointer")).length, 3, result.errors.join("\n"));
  assert.notEqual(result.normalizedContractFingerprint, "PASS");
}));

function mutateOwner(base, owner, relative, change) {
  const filename = path.join(ownerDir(base, owner), relative);
  const doc = YAML.parse(readFileSync(filename, "utf8"));
  change(doc);
  writeFileSync(filename, YAML.stringify(doc));
  writeFileSync(generatedOperationsPath(owner, base), generatedOperationSource(owner, base));
}

const parameter = doc => doc.paths["/v1/public/cities"].get.parameters[0];
const operation = doc => doc.paths["/v1/public/cities"].get;

const malformedParameters = {
  missing: p => { delete p.schema; },
  both: p => { p.content = { "application/json": { schema: { type: "integer" } } }; },
  scalar: p => { p.schema = "integer"; },
  null: p => { p.schema = null; },
  emptyContent: p => { delete p.schema; p.content = {}; },
  multipleContent: p => {
    delete p.schema;
    p.content = { "application/json": {}, "text/plain": {} };
  },
  invalidContent: p => { delete p.schema; p.content = { "application/json": null }; },
  invalidRequired: p => { p.required = "false"; },
  conflictingExamples: p => { p.example = 1; p.examples = { one: { value: 1 } }; },
};
for (const [name, change] of Object.entries(malformedParameters)) {
  test("parameter representation rejects " + name + " even with regenerated metadata", () => fixture(base => {
    mutateOwner(base, "dsh", "paths/stores.yaml", doc => change(parameter(doc)));
    const result = validate("dsh", base);
    assert.ok(result.errors.some(error => /parameter|schema|content|example|required/i.test(error)), result.errors.join("\n"));
    assert.notEqual(result.normalizedContractFingerprint, "PASS");
  }));
}

test("valid schema and content representations remain admissible", () => fixture(base => {
  mutateOwner(base, "dsh", "paths/stores.yaml", doc => {
    const p = parameter(doc);
    delete p.schema;
    p.content = { "application/json": { schema: { type: "integer" } } };
  });
  assert.deepEqual(validate("dsh", base).errors, []);
  mutateOwner(base, "dsh", "paths/stores.yaml", doc => {
    const p = parameter(doc);
    delete p.content;
    p.schema = true;
  });
  assert.deepEqual(validate("dsh", base).errors, []);
}));

const malformedComponents = {
  parameter: components => { components.parameters.Bad = { name: "q", in: "query" }; },
  header: components => { components.headers = { Bad: { schema: "string" } }; },
  response: components => { components.responses.Bad = { description: "ok", content: { "application/json": null } }; },
  requestBody: components => { components.requestBodies = { Bad: { required: true } }; },
};
for (const [name, change] of Object.entries(malformedComponents)) {
  test("malformed unused " + name + " component cannot hide behind valid operations", () => fixture(base => {
    mutateOwner(base, "dsh", "dsh.openapi.yaml", doc => {
      doc.components.parameters ??= {};
      doc.components.responses ??= {};
      change(doc.components);
    });
    assert.ok(validate("dsh", base).errors.length > 0);
  }));
}

test("a reference cannot hide invalid fields or a malformed resolved parameter", () => fixture(base => {
  mutateOwner(base, "dsh", "dsh.openapi.yaml", doc => {
    doc.components.parameters ??= {};
    doc.components.parameters.Bad = { name: "limit", in: "query", schema: { type: "integer" }, unexpected: true };
  });
  mutateOwner(base, "dsh", "paths/stores.yaml", doc => {
    operation(doc).parameters[0] = { $ref: "../dsh.openapi.yaml#/components/parameters/Bad", schema: { type: "integer" } };
  });
  const result = validate("dsh", base);
  assert.ok(result.errors.length > 0);
}));

const malformedOperations = {
  typo: op => { op.requestBoddy = { content: { "application/json": {} } }; },
  missingContent: op => { op.requestBody = { required: true }; },
  invalidRequired: op => { op.requestBody = { required: "true", content: { "application/json": {} } }; },
  emptyContent: op => { op.requestBody = { content: {} }; },
  invalidResponseContent: op => { op.responses["200"].content = "json"; },
  invalidDeprecated: op => { op.deprecated = "false"; },
};
for (const [name, change] of Object.entries(malformedOperations)) {
  test("operation representation rejects " + name, () => fixture(base => {
    mutateOwner(base, "dsh", "paths/stores.yaml", doc => change(operation(doc)));
    assert.ok(validate("dsh", base).errors.length > 0);
  }));
}

test("entrypoint requires actual versioned information", () => fixture(base => {
  mutateOwner(base, "identity", "identity.openapi.yaml", doc => { delete doc.info.title; });
  assert.ok(validate("identity", base).errors.length > 0);
}));

test("malformed object boundaries fail independently of generated parity", () => fixture(base => {
  const filename = path.join(ownerDir(base, "dsh"), "paths/stores.yaml");
  const original = readFileSync(filename, "utf8");
  const cases = [
    ["Invalid parameter list", op => { op.parameters = {}; }],
    ["Invalid parameter name or location", op => { op.parameters[0].name = ""; }],
    ["Invalid parameter name or location", op => { op.parameters[0].in = "body"; }],
    ["Path parameter must be required", op => { op.parameters[0].in = "path"; op.parameters[0].required = false; }],
    ["Invalid response headers", op => { op.responses["200"].headers = []; }],
    ["Duplicate response header", op => { op.responses["200"].headers = { A: { schema: {} }, a: { schema: {} } }; }],
    ["Invalid links", op => { op.responses["200"].links = []; }],
    ["Empty content media type", op => { op.requestBody = { content: { "": {} } }; }],
    ["Missing responses", op => { delete op.responses; }],
    ["Invalid operation security", op => { op.security = [null, {}, []]; }],
    ["Invalid security scheme scopes", op => { op.security = [{ OpaqueSession: [1] }]; }],
    ["Missing or unsafe operationId", op => { op.operationId = "bad name"; }],
    ["Invalid OpenAPI object", (_op, doc) => { doc.paths["/v1/public/cities"].get = null; }],
  ];
  for (const [reason, change] of cases) {
    const doc = YAML.parse(original);
    change(operation(doc), doc);
    writeFileSync(filename, YAML.stringify(doc));
    const errors = validate("dsh", base).errors;
    assert.ok(errors.some(error => error.includes(reason)), reason + ": " + errors.join("\n"));
  }
}));

test("component maps and typed reference cycles fail with precise evidence", () => fixture(base => {
  const filename = path.join(ownerDir(base, "dsh"), "dsh.openapi.yaml");
  const original = readFileSync(filename, "utf8");
  const cases = [
    ["Invalid component map", doc => { doc.components.headers = []; }],
    ["Cyclic OpenAPI object reference", doc => {
      doc.components.parameters ??= {};
      doc.components.parameters.CycleA = { $ref: "#/components/parameters/CycleB" };
      doc.components.parameters.CycleB = { $ref: "#/components/parameters/CycleA" };
    }],
    ["Invalid OpenAPI paths map", doc => { doc.paths = []; }],
    ["Invalid OpenAPI 3.1 schema", doc => { doc.components.schemas.Bad = "invalid"; }],
  ];
  for (const [reason, change] of cases) {
    const doc = YAML.parse(original);
    change(doc);
    writeFileSync(filename, YAML.stringify(doc));
    const errors = validate("dsh", base).errors;
    assert.ok(errors.some(error => error.includes(reason)), reason + ": " + errors.join("\n"));
  }
}));

test("unreadable generated artifact fails its owner without hiding other owners", () => fixture(base => {
  const filename = generatedOperationsPath("dsh", base);
  rmSync(filename);
  mkdirSync(filename);
  const results = validateOwners(owners, base);
  assert.deepEqual(results[0].errors, []);
  assert.match(results[1].errors.join("\n"), /Owner contract validation failed/);
  assert.deepEqual(results[2].errors, []);
}));

test("owner source directory must be a real directory", () => fixture(base => {
  const filename = ownerDir(base, "dsh");
  rmSync(filename, { recursive: true });
  writeFileSync(filename, "not a directory");
  assert.match(validate("dsh", base).errors.join("\n"), /Unsafe owner contract directory/);
}));

test("an inadmissible generator path convention is reported as failed derivation", () => fixture(base => {
  const filename = path.join(ownerDir(base, "dsh"), "dsh.openapi.yaml");
  const doc = YAML.parse(readFileSync(filename, "utf8"));
  const route = doc.paths["/v1/public/cities"];
  assert.ok(route.$ref.startsWith("./"));
  route.$ref = route.$ref.slice(2);
  writeFileSync(filename, YAML.stringify(doc));
  const result = validate("dsh", base);
  assert.ok(result.errors.length > 0);
  assert.notEqual(result.normalizedContractFingerprint, "PASS");
}));
