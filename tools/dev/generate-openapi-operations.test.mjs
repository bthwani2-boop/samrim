import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatedOperationSource, generatedOperationsPath, operationRows } from "./generate-openapi-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fixture(t, owner) {
  const base = mkdtempSync(path.join(tmpdir(), "bthwani-generated-operation-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = path.join("services", owner, "contracts", "openapi");
  cpSync(path.join(root, dir), path.join(base, dir), { recursive: true });
  return { base, contract: path.join(base, dir) };
}

for (const owner of ["identity", "dsh"]) {
  test(owner + " operations are exactly reproducible and match owner OpenAPI", () => {
    const first = generatedOperationSource(owner);
    const second = generatedOperationSource(owner);
    assert.equal(first, second);
    assert.equal(first, readFileSync(generatedOperationsPath(owner), "utf8"));
    const rows = operationRows(owner);
    assert.equal(rows.length, owner === "identity" ? 13 : 17);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.every(row => row.path.startsWith("/")));
  });

  test(owner + " refuses stale method/path metadata after real OpenAPI mutation", t => {
    const { base, contract } = fixture(t, owner);
    const entryFile = path.join(contract, owner + ".openapi.yaml");
    const initial = generatedOperationSource(owner, base);
    const entry = readFileSync(entryFile, "utf8");
    const oldPath = owner === "identity" ? "/v1/sessions/current:" : "/v1/stores/mine:";
    assert.ok(entry.includes(oldPath), "mutation must target current contract");
    writeFileSync(entryFile, entry.replace(oldPath, oldPath.replace(":", "-drift:")));
    assert.notEqual(generatedOperationSource(owner, base), initial,
      "a new owner route must invalidate the checked-in generated operation manifest");
  });
}

test("generator does not follow a path fragment outside the owner directory", t => {
  const { base, contract } = fixture(t, "dsh");
  const mainFile = path.join(contract, "dsh.openapi.yaml");
  const source = readFileSync(mainFile, "utf8");
  assert.ok(source.includes("./paths/stores.yaml"));
  writeFileSync(mainFile, source.replace("./paths/stores.yaml", "./paths/../shadow.yaml"));
  assert.throws(() => operationRows("dsh", base), /outside canonical owner/);
});

test("generator rejects operation IDs that collide across path fragments", t => {
  const { base, contract } = fixture(t, "dsh");
  const file = path.join(contract, "paths", "stores.yaml");
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("operationId: listPublicStores"));
  writeFileSync(file, source.replace("operationId: listPublicStores", "operationId: listPublicVerticals"));
  assert.throws(() => operationRows("dsh", base), /duplicate or unsafe operationId/);
});

test("WLT remains an intentionally empty contract, not an invented generated client", () => {
  assert.throws(() => operationRows("wlt"), /Unsupported executable owner/);
});
