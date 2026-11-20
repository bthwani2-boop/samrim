import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inventory, summary } from "./source-inventory.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bthwani-source-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const init = spawnSync("git", ["-C", root, "init", "-q"], { windowsHide: true });
  assert.equal(init.status, 0, "Git must initialize an isolated temporary repository");
  function file(name, content) {
    const target = path.join(root, ...name.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  }
  function stage(...names) {
    const cmd = spawnSync("git", ["-C", root, "add", "--", ...names], { windowsHide: true });
    assert.equal(cmd.status, 0);
  }
  return { root, file, stage };
}

test("tracks both Git source and new untracked authored files including nested tests", t => {
  const x = fixture(t);
  x.file("services/dsh/clients/index.ts", "export const owner = 1;\n");
  x.file("apps/customer/src/feature/new.test.mjs", "import { owner } from 'root';\n");
  x.stage("services/dsh/clients/index.ts");
  const rows = inventory(x.root);
  assert.deepEqual(rows.map(row => [row.path, row.tracked]), [
    ["apps/customer/src/feature/new.test.mjs", false],
    ["services/dsh/clients/index.ts", true],
  ]);
  assert.equal(rows[0].kind, "test-fixture");
  assert.equal(rows[0].owner, "surface:customer");
  assert.equal(rows[1].owner, "owner:dsh");
  assert.equal(rows[1].kind, "owner-client");
  assert.equal(rows[1].lines, 1);
  assert.deepEqual(summary(rows), {
    files: 2, tracked: 1, untracked: 1, linkedOrMissing: 0,
    owners: { "owner:dsh": 1, "surface:customer": 1 },
    kinds: { "owner-client": 1, "test-fixture": 1 },
  });
});

test("resolves TypeScript relative, export, dynamic literal and package-export consumers", t => {
  const x = fixture(t);
  x.file("packages/test-kit/package.json", JSON.stringify({
    name: "@synthetic/test-kit", exports: { ".": { types: "./src/index.ts" } },
  }));
  x.file("packages/test-kit/src/index.ts", "export const value = 1;\n");
  x.file("apps/merchant/src/features/inner.ts", "export const inner = true;\n");
  x.file("apps/merchant/src/features/dynamic.ts", "export const dynamic = true;\n");
  x.file("apps/merchant/src/features/consumer.ts",
    "import { value } from '@synthetic/test-kit';\n" +
    "export { inner } from './inner.js';\n" +
    "const load = () => import('./dynamic.ts');\n" +
    "// import './not-a-real-module.js';\n");
  x.stage("packages/test-kit/package.json", "packages/test-kit/src/index.ts",
    "apps/merchant/src/features/inner.ts", "apps/merchant/src/features/dynamic.ts",
    "apps/merchant/src/features/consumer.ts");
  const rows = inventory(x.root);
  const lookup = new Map(rows.map(row => [row.path, row]));
  const consumer = lookup.get("apps/merchant/src/features/consumer.ts");
  assert.deepEqual(consumer.imports, ["./dynamic.ts", "./inner.js", "@synthetic/test-kit"]);
  assert.deepEqual(lookup.get("packages/test-kit/src/index.ts").importedBy, [consumer.path]);
  assert.deepEqual(lookup.get("apps/merchant/src/features/dynamic.ts").importedBy, [consumer.path]);
  assert.deepEqual(lookup.get("apps/merchant/src/features/inner.ts").importedBy, [consumer.path]);
  assert.equal(lookup.get("packages/test-kit/src/index.ts").owner, "package:test-kit");
});

test("classifies route entries, owner contracts, migrations and generated output separately", t => {
  const x = fixture(t);
  x.file("apps/customer/app/(tabs)/index.tsx", "export default function Page() { return null; }\n");
  x.file("apps/merchant/app/_layout.tsx", "export default function Layout() { return null; }\n");
  x.file("services/identity/contracts/openapi/paths/sessions.yaml", "paths: {}\n");
  x.file("services/dsh/database/migrations/001_create_store.sql", "select 1;\n");
  x.file("apps/customer/src/fixtures/sample.ts", "export const data = true;\n");
  x.file("packages/design-system/generated/colors.ts", "export const generated = true;\n");
  const rows = inventory(x.root);
  assert.equal(rows.length, 6);
  const types = new Map(rows.map(row => [row.path, row.kind]));
  assert.equal(types.get("apps/customer/app/(tabs)/index.tsx"), "route-entry");
  assert.equal(types.get("apps/merchant/app/_layout.tsx"), "route-entry");
  assert.equal(types.get("services/identity/contracts/openapi/paths/sessions.yaml"), "owner-contract");
  assert.equal(types.get("services/dsh/database/migrations/001_create_store.sql"), "migration");
  assert.equal(types.get("apps/customer/src/fixtures/sample.ts"), "test-fixture");
  assert.equal(types.get("packages/design-system/generated/colors.ts"), "generated");
});

test("missing tracked source stays visible but is never read or treated as an executable consumer", t => {
  const x = fixture(t);
  x.file("services/identity/clients/index.ts", "export const source = true;\n");
  x.stage("services/identity/clients/index.ts");
  rmSync(path.join(x.root, "services", "identity", "clients", "index.ts"));
  const rows = inventory(x.root);
  assert.equal(rows[0].tracked, true);
  assert.equal(rows[0].state, "missing-or-linked");
  assert.equal(rows[0].bytes, null);
  assert.deepEqual(rows[0].imports, []);
});

test("linked authored source is reported, not followed into external paths", t => {
  const x = fixture(t);
  const outside = mkdtempSync(path.join(tmpdir(), "bthwani-inventory-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const target = path.join(outside, "private.ts");
  writeFileSync(target, "export const privateData = 'private';\n");
  const link = path.join(x.root, "apps", "captain", "src", "linked.ts");
  mkdirSync(path.dirname(link), { recursive: true });
  try { symlinkSync(target, link, "file"); }
  catch (error) {
    t.skip("Platform policy forbids symlink fixture: " + error.code);
    return;
  }
  const rows = inventory(x.root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "apps/captain/src/linked.ts");
  assert.equal(rows[0].state, "missing-or-linked");
  assert.equal(rows[0].bytes, null);
  assert.equal(rows[0].lines, null);
  assert.deepEqual(rows[0].imports, []);
});

test("Go imports are extracted from both single and grouped statements", t => {
  const x = fixture(t);
  x.file("services/dsh/backend/internal/example/source.go",
    'package example\nimport "fmt"\nimport (\n "context"\n alias "database/sql"\n)\n');
  assert.deepEqual(inventory(x.root)[0].imports, ["context", "database/sql", "fmt"]);
});

test("CLI rejects unsupported flags without generating a persistent inventory file", () => {
  const script = path.resolve(import.meta.dirname, "source-inventory.mjs");
  const command = spawnSync(process.execPath, [script, "--output=private.json"], {
    encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  assert.equal(command.status, 2);
  assert.match(command.stderr, /Usage: node tools\/dev\/source-inventory\.mjs/);
});
