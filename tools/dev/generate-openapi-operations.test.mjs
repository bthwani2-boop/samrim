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

const counts = { identity: 13, dsh: 19, wlt: 2 };
const samplePaths = { identity: "/v1/sessions/current:", dsh: "/v1/stores/mine:", wlt: "/v1/wallets/me:" };
for (const owner of Object.keys(counts)) {
  test(owner + " operations are exactly reproducible and match owner OpenAPI", () => {
    const first = generatedOperationSource(owner);
    const second = generatedOperationSource(owner);
    assert.equal(first, second);
    assert.equal(first, readFileSync(generatedOperationsPath(owner), "utf8"));
    const rows = operationRows(owner);
    assert.equal(rows.length, counts[owner]);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.every(row => row.path.startsWith("/")));
  });

  test(owner + " refuses stale method/path metadata after real OpenAPI mutation", t => {
    const { base, contract } = fixture(t, owner);
    const entryFile = path.join(contract, owner + ".openapi.yaml");
    const initial = generatedOperationSource(owner, base);
    const entry = readFileSync(entryFile, "utf8");
    const oldPath = samplePaths[owner];
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

test("owner fingerprints detect changes beyond operation names and routes", t => {
  const { base, contract } = fixture(t, "wlt");
  const baseline = generatedOperationSource("wlt", base);
  const rows = operationRows("wlt", base);
  const mutations = [
    ["paths/wallets.yaml", "'403':", "'404':"],
    ["paths/wallets.yaml", "const: no-store", "const: private"],
    ["paths/wallets.yaml", "- OpaqueSession: []", "- OpaqueSession: [other]"],
    ["paths/wallets.yaml", "#/components/schemas/Error", "#/components/schemas/CustomerWalletBalance"],
    ["wlt.openapi.yaml", "additionalProperties: false", "additionalProperties: true"],
  ];
  for (const [file, before, after] of mutations) {
    const filename = path.join(contract, file);
    const source = readFileSync(filename, "utf8");
    assert.ok(source.includes(before));
    writeFileSync(filename, source.replace(before, after));
    assert.deepEqual(operationRows("wlt", base), rows);
    assert.notEqual(generatedOperationSource("wlt", base), baseline, before);
    writeFileSync(filename, source);
  }
});

test("fingerprints ignore YAML comments and mapping order", t => {
  const { base, contract } = fixture(t, "wlt");
  const baseline = generatedOperationSource("wlt", base);
  const filename = path.join(contract, "paths", "wallets.yaml");
  const source = readFileSync(filename, "utf8");
  const changed = source.replace("type: string, const: no-store", "const: no-store, type: string");
  assert.notEqual(changed, source);
  writeFileSync(filename, "# comment outside the parsed contract\n" + changed);
  assert.equal(generatedOperationSource("wlt", base), baseline);
});
