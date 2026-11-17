import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = fileURLToPath(new URL("../..", import.meta.url));
const documents = YAML.parseAllDocuments(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
for (const document of documents) assert.deepEqual(document.errors, []);
const lock = Object.assign({}, ...documents.map(document => document.toJS()));
const modules = join(root, "node_modules");
const hoisted = join(modules, ".pnpm", "node_modules");
const versions = ["2.3.2", "4.0.7"];
const consumers = [
  ["micromatch", "2.3.2"],
  ["jest-util", "2.3.2"],
  ["tinyglobby", "4.0.7"],
  ["fdir", "4.0.7"],
  ["knip", "4.0.7"],
  ["@expo/cli", "4.0.7"],
  ["@expo/metro-config", "4.0.7"],
];

test("every picomatch snapshot and dependency reference uses the checked-in patch", () => {
  const expected = versions.map(version => {
    const hash = lock.patchedDependencies[`picomatch@${version}`];
    assert.match(hash, /^[a-f\d]{64}$/);
    return `${version}(patch_hash=${hash})`;
  });
  const snapshots = Object.keys(lock.snapshots).filter(name => name.startsWith("picomatch@"));
  assert.deepEqual(snapshots, expected.map(entry => `picomatch@${entry}`));
  for (const [name, snapshot] of Object.entries(lock.snapshots)) {
    for (const deps of [snapshot.dependencies, snapshot.optionalDependencies]) {
      if (deps?.picomatch) assert.ok(expected.includes(deps.picomatch), name);
    }
  }
});

for (const [consumer, version] of consumers) {
  test(`${consumer} resolves hardened picomatch ${version} and retains ordinary glob behavior`, () => {
    const parent = realpathSync(join(consumer === "knip" ? modules : hoisted, consumer));
    const require = createRequire(join(parent, "package.json"));
    const picomatch = require("picomatch");
    const source = readFileSync(require.resolve("picomatch/lib/parse.js"), "utf8");
    assert.match(source, /CVE-2026-112366/);
    assert.equal(require("picomatch/package.json").version, version);

    assert.equal(picomatch("**/*.tsx")("app/routes/index.tsx"), true);
    assert.equal(picomatch("**/*.tsx")("app/routes/index.js"), false);
    assert.equal(picomatch("+(alpha|beta)")("alphabeta"), true);
    assert.equal(picomatch("@(alpha|beta)")("gamma"), false);
    assert.equal(picomatch("+([*+])", { literalBrackets: false })("*+"), true);

    // Exercise the fixed compiler on a short ordinary filename, without
    // timing a match or running an unpatched expression against crafted input.
    const repeatedWildcard = "+(view-*.tsx)";
    assert.equal(picomatch(repeatedWildcard)("view-index.tsx"), false);
    assert.equal(picomatch(repeatedWildcard)(repeatedWildcard), true);
    assert.equal(picomatch(repeatedWildcard, { maxExtglobRecursion: false })("view-index.tsx"), false);
  });
}
