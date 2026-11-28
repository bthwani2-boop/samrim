import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inventory, reviewCandidates, summary } from "./source-inventory.mjs";

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
  x.file("apps/customer/app/api/wallet+api.ts", "export function GET() {}\n");
  x.file("apps/merchant/app/_layout.tsx", "export default function Layout() { return null; }\n");
  x.file("apps/merchant/app/orders/[id].tsx", "export { default } from './index';\n");
  x.file("apps/captain/app/(tabs)/wallet.tsx", "export { default } from './index';\n");
  x.file("apps/control-panel/app/orders/page.tsx", "export default function Page() {}\n");
  x.file("apps/control-panel/app/orders/helpers.ts", "export const fields = [];\n");
  x.file("services/identity/contracts/openapi/paths/sessions.yaml", "# Session contract\r\npaths: {}\r\n");
  x.file("services/dsh/database/migrations/001_create_store.sql", "-- Store baseline\nselect 1;");
  x.file("tools/dev/example.ps1", "# Example\r\nWrite-Output 1\r\n");
  x.file("apps/customer/src/fixtures/sample.ts", "export const data = true;\n");
  x.file("packages/design-system/generated/colors.ts", "export const generated = true;\n");
  const rows = inventory(x.root);
  assert.equal(rows.length, 12);
  const types = new Map(rows.map(row => [row.path, row.kind]));
  assert.equal(types.get("apps/customer/app/(tabs)/index.tsx"), "route-entry");
  assert.equal(types.get("apps/customer/app/api/wallet+api.ts"), "route-entry");
  assert.equal(types.get("apps/merchant/app/_layout.tsx"), "route-entry");
  assert.equal(types.get("apps/merchant/app/orders/[id].tsx"), "route-entry");
  assert.equal(types.get("apps/captain/app/(tabs)/wallet.tsx"), "route-entry");
  assert.equal(types.get("apps/control-panel/app/orders/page.tsx"), "route-entry");
  assert.equal(types.get("apps/control-panel/app/orders/helpers.ts"), "source");
  assert.equal(types.get("services/identity/contracts/openapi/paths/sessions.yaml"), "owner-contract");
  assert.equal(types.get("services/dsh/database/migrations/001_create_store.sql"), "migration");
  assert.equal(types.get("apps/customer/src/fixtures/sample.ts"), "test-fixture");
  assert.equal(types.get("packages/design-system/generated/colors.ts"), "generated");
  for (const type of ["owner-contract", "migration", "tooling"]) {
    const row = rows.find(row => row.kind === type);
    assert.equal(row?.lines, 2, type);
    assert.deepEqual(row.imports, [], type);
  }
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

test("cohesion review reports authored candidates without failing short routes or generated and test files", t => {
  const x = fixture(t);
  x.file("services/dsh/clients/discovery.ts", "export const value = 1;\n".repeat(501));
  x.file("services/dsh/backend/internal/discovery/http.go", "package discovery\n".repeat(701));
  x.file("apps/customer/app/(tabs)/index.tsx", "export default function Page() { return null; }\n");
  x.file("apps/customer/src/features/Orders/screen.tsx", "export const Screen = null;\n");
  x.file("apps/customer/src/features/orders/tests/big.test.mjs", "export const testValue = 1;\n".repeat(801));
  x.file("packages/design-system/generated/big.ts", "export const generated = 1;\n".repeat(901));
  x.file("apps/merchant/src/features/orders/misc/client.ts", "export const misplaced = true;\n");
  const candidates = reviewCandidates(inventory(x.root));
  assert.ok(candidates.some(x => x.kind === "cohesion-review" &&
    x.path === "services/dsh/clients/discovery.ts" && x.severity === "investigate"));
  assert.ok(candidates.some(x => x.kind === "cohesion-review" &&
    x.path.endsWith("/discovery/http.go") && x.severity === "exception-required"));
  assert.ok(candidates.some(x => x.kind === "feature-naming-review" &&
    x.path.includes("/Orders/")));
  assert.ok(candidates.some(x => x.kind === "generic-directory-review" &&
    x.path.includes("/misc/")));
  assert.ok(candidates.every(x => !x.path.includes("generated/") &&
    !x.path.includes(".test.mjs") && !x.path.includes("/app/")));
});

test("a legal small feature and owner SDK facade do not require a cohesion exception", t => {
  const x = fixture(t);
  x.file("services/dsh/clients/index.ts", "export { store } from './stores.ts';\n");
  x.file("services/dsh/clients/stores.ts", "export const store = 1;\n");
  x.file("apps/merchant/src/features/stores/standing.ts", "export const standing = true;\n");
  assert.deepEqual(reviewCandidates(inventory(x.root)), []);
});

test("Go integration test files are fixtures, not oversized production sources", t => {
  const x = fixture(t);
  x.file("services/dsh/backend/internal/stores/postgres_integration_test.go",
    "package stores\n".repeat(801));
  const rows = inventory(x.root);
  assert.equal(rows[0].kind, "test-fixture");
  assert.deepEqual(reviewCandidates(rows), []);
});

test("resolves literal require.resolve and import.meta.resolve consumers during move audits", t => {
  const x = fixture(t);
  x.file("apps/customer/src/features/stores/merchant.ts", "export const store = 1;\n");
  x.file("apps/customer/src/features/stores/captain.ts", "export const captain = 1;\n");
  x.file("apps/customer/src/features/stores/consumer.ts",
    "const merchant = import.meta.resolve('./merchant.ts');\n" +
    "const captain = require.resolve('./captain.ts');\n");
  const rows = inventory(x.root);
  const lookup = new Map(rows.map(row => [row.path, row]));
  const consumer = "apps/customer/src/features/stores/consumer.ts";
  assert.deepEqual(lookup.get(consumer).imports, ["./captain.ts", "./merchant.ts"]);
  for (const target of ["captain.ts", "merchant.ts"]) {
    assert.deepEqual(
      lookup.get(`apps/customer/src/features/stores/${target}`).importedBy,
      [consumer],
    );
  }
});

test("source enumeration does not execute Git from the caller PATH", t => {
  const x = fixture(t);
  x.file("services/dsh/clients/index.ts", "export const owner = 1;\n");
  x.stage("services/dsh/clients/index.ts");
  const previous = process.env.PATH;
  try {
    process.env.PATH = x.root;
    assert.deepEqual(inventory(x.root).map(row => row.path), ["services/dsh/clients/index.ts"]);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

test("canonical Git inventory retains tracked and missing source despite an alternate index", t => {
  const x = fixture(t);
  const name = "services/dsh/clients/index.ts";
  x.file(name, "export const owner = 1;\n");
  x.stage(name);
  const previous = process.env.GIT_INDEX_FILE;
  try {
    process.env.GIT_INDEX_FILE = path.join(x.root, ".git", "alternate-index");
    assert.equal(inventory(x.root).find(row => row.path === name)?.tracked, true);
    rmSync(path.join(x.root, name));
    const row = inventory(x.root).find(row => row.path === name);
    assert.equal(row?.tracked, true);
    assert.equal(row?.state, "missing-or-linked");
  } finally {
    if (previous === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = previous;
  }
});

test("inventory never follows a hard-linked source into the consumer census", t => {
  const x = fixture(t);
  const original = x.file("apps/customer/src/source.ts", "import './private.ts';\n");
  linkSync(original, path.join(x.root, "apps/customer/src/alias.ts"));
  for (const row of inventory(x.root)) {
    assert.notEqual(row.state, "file");
    assert.equal(row.lines, null);
    assert.deepEqual(row.imports, []);
  }
});

test("inventory refuses sensitive or non-text source before publishing imports", t => {
  const x = fixture(t);
  const marker = "ghp_" + "a".repeat(30);
  x.file("apps/customer/src/sensitive.ts", "import '" + marker + "';\n");
  x.file("apps/customer/src/binary.ts", Buffer.from([0, 255, 254, 1]));
  x.file("apps/customer/credentials.json", '{"name":"synthetic"}');
  const rows = inventory(x.root);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.state, "blocked");
    assert.equal(row.lines, null);
    assert.deepEqual(row.imports, []);
  }
  assert.ok(!JSON.stringify(rows).includes(marker));
});

test("inventory fails closed without echoing a sensitive filename", t => {
  const x = fixture(t);
  const marker = "ghp_" + "a".repeat(30);
  x.file("apps/customer/src/" + marker + ".ts", "export const ordinary = 1;\n");
  assert.throws(() => inventory(x.root), error =>
    /sensitive source path/i.test(error.message) && !error.message.includes(marker));
});

test("inventory classifies complete metadata without opening binary assets, rejects invalid text and reports replaced paths", t => {
  const x = fixture(t);
  x.file("governance/engineering.md", "# Owner\n");
  x.file("infra/compose.yaml", "services: {}\n");
  x.file("tools/dev/empty.mjs", "");
  x.file("apps/customer/assets/logo.png", Buffer.from([0, 255, 1, 2]));
  x.file("apps/customer/src/invalid.ts", Buffer.from([0xff, 0xfe]));
  x.file("apps/customer/src/oversized.ts", Buffer.alloc(4 * 1024 * 1024 + 1, 65));
  const replaced = x.file("apps/customer/src/replaced.ts", "export const data = 1;\n");
  x.stage("apps/customer/src/replaced.ts");
  rmSync(replaced);
  mkdirSync(replaced);
  const rows = inventory(x.root);
  const lookup = new Map(rows.map(row => [row.path, row]));
  assert.equal(lookup.get("governance/engineering.md").owner, "governance");
  assert.equal(lookup.get("governance/engineering.md").kind, "documentation");
  assert.equal(lookup.get("infra/compose.yaml").owner, "infrastructure");
  assert.equal(lookup.get("tools/dev/empty.mjs").owner, "developer-tooling");
  assert.equal(lookup.get("tools/dev/empty.mjs").lines, 0);
  assert.equal(lookup.get("apps/customer/assets/logo.png").kind, "asset");
  assert.equal(lookup.get("apps/customer/assets/logo.png").bytes, 4);
  assert.equal(lookup.get("apps/customer/assets/logo.png").lines, null);
  assert.equal(lookup.get("apps/customer/src/invalid.ts").state, "blocked");
  assert.equal(lookup.get("apps/customer/src/oversized.ts").state, "blocked");
  assert.equal(lookup.get("apps/customer/src/replaced.ts").state, "non-file");
  assert.equal(summary(rows).linkedOrMissing, 3);
  assert.deepEqual(reviewCandidates(rows), []);
});

test("literal package exports, subpaths and unsupported mappings remain accurately bounded", t => {
  const x = fixture(t);
  x.file("packages/direct/package.json", '{"name":"@synthetic/direct","exports":"./index.ts"}');
  x.file("packages/direct/index.ts", "export const direct = true;\n");
  x.file("packages/sub/package.json", '{"name":"@synthetic/sub","exports":{"./value":"./value.ts","./*":"./other.ts","./missing":"./missing.ts"}}');
  x.file("packages/sub/value.ts", "export const value = true;\n");
  x.file("packages/sub/other.ts", "export const other = true;\n");
  x.file("packages/malformed/package.json", "{ malformed");
  x.file("packages/private/package.json", '{"name":"@synthetic/private"}');
  const consumer = "apps/customer/src/use.ts";
  x.file(consumer, [
    'import "@synthetic/sub/unknown";',
    'import "@synthetic/sub/value";',
    'import "@synthetic/direct";',
    'import "@synthetic/sub/missing";',
    'import "../../../../outside.ts";',
    'import "@synthetic/private";',
  ].join("\n"));
  const lookup = new Map(inventory(x.root).map(row => [row.path, row]));
  assert.deepEqual(lookup.get("packages/direct/index.ts").importedBy, [consumer]);
  assert.deepEqual(lookup.get("packages/sub/value.ts").importedBy, [consumer]);
  assert.deepEqual(lookup.get("packages/sub/other.ts").importedBy, []);
  assert.equal(lookup.get(consumer).imports.length, 6);
});

test("review candidates distinguish low severity and missing authored files", t => {
  const x = fixture(t);
  x.file("apps/merchant/src/features/Upper/misc/screen.ts", "export const value = 1;\n".repeat(351));
  const missing = x.file("tools/dev/deleted.mjs", "export const value = 1;\n".repeat(701));
  x.stage("tools/dev/deleted.mjs");
  rmSync(missing);
  const candidates = reviewCandidates(inventory(x.root));
  assert.equal(candidates.length, 3);
  assert.equal(candidates.find(row => row.kind === "cohesion-review").severity, "review");
  assert.ok(candidates.every(row => row.path.endsWith("screen.ts")));
});
