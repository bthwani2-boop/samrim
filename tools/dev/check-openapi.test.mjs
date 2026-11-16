import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validate } from "./check-openapi.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function mutate(owner, name, transform) {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-openapi-"));
  try {
    const relative = `services/${owner}/contracts/openapi`;
    cpSync(path.join(root, relative), path.join(tmp, relative), { recursive: true });
    const file = path.join(tmp, relative, name);
    const original = readFileSync(file, "utf8");
    const next = transform(original);
    assert.notEqual(original, next, "Fixture must actually change");
    writeFileSync(file, next, "utf8");
    return validate(owner, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function hasError(result, fragment) {
  assert.ok(result.errors.some((error) => error.includes(fragment)),
    `Expected ${JSON.stringify(fragment)} in ${JSON.stringify(result.errors)}`);
}

test("all current owner OpenAPI 3.1 documents parse; unimplemented WLT stays explicitly empty", () => {
  for (const owner of ["identity", "dsh", "wlt"]) {
    const result = validate(owner);
    assert.deepEqual(result.errors, [], `${owner} has invalid OpenAPI`);
  }
  assert.equal(validate("wlt").operations, 0);
  assert.ok(validate("identity").operations > 0);
  assert.ok(validate("dsh").operations > 0);
});

test("reject duplicate YAML mapping keys instead of silently accepting the last value", () => {
  const result = mutate("identity", "identity.openapi.yaml", (s) => `openapi: 3.1.0\n${s}`);
  assert.ok(result.errors.length > 0);
});

test("reject missing referenced modules", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace("./paths/stores.yaml#/paths/", "./paths/does-not-exist.yaml#/paths/"));
  hasError(result, "missing $ref file");
});

test("reject duplicate operationId across path fragments", () => {
  const result = mutate("dsh", "paths/offers.yaml", (s) =>
    s.replace("operationId: listPublicOffers", "operationId: listPublicStores"));
  hasError(result, "Duplicate operationId");
});

test("reject undeclared authorization schemes", () => {
  const result = mutate("identity", "paths/session.yaml", (s) =>
    s.replace("- OpaqueSession: []", "- NotRegistered: []"));
  hasError(result, "Unknown security scheme");
});

test("reject missing required URI path parameter", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace("name: id", "name: mismatch"));
  hasError(result, "Missing required path parameter");
});

test("reject a PathItem fragment that is not linked from the owner entrypoint", () => {
  const result = mutate("dsh", "paths/stores.yaml", (s) =>
    s.replace("  /v1/public/stores:\n", "  /v1/test/unlinked:\n"));
  assert.ok(result.errors.length > 0);
});
