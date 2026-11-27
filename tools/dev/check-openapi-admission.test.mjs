import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
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
