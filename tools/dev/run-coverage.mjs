#!/usr/bin/env node
// Report coverage actually observed by the pinned Node test runner.
// Sonar owns the acceptance threshold; missing reports or failed tests fail closed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const report = resolve(root, "coverage/lcov.info");
mkdirSync(dirname(report), { recursive: true });
const baselineTests = [
  "tools/governance/verify-foundation.test.mjs",
  "tools/governance/review-examples.test.mjs",
  "tools/security/verify-secrets.test.mjs",
  "tools/mobile/verify-rtl.test.mjs",
  "tools/mobile/verify-expo-config.test.mjs",
  "tools/mobile/verify-application-boundaries.test.mjs",
  "packages/tamagui-config/tools/appearance.test.mjs",
  "tools/dev/verify-source-execution.test.mjs",
  "tools/dev/dsh-public-client.test.mjs",
  "tools/dev/check-openapi.test.mjs",
  "tools/mobile/verify-native-config.test.mjs",
];

// Feature and journey tests must enter coverage with the source they protect.
// Discover only established Node test locations; do not run E2E/manual or
// generated browser tests as a side effect of source-coverage collection.
function discoverTests(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) return discoverTests(full);
      if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        return [relative(root, full).replaceAll("\\", "/")];
      }
      return [];
    });
}
const testFiles = [...new Set([
  ...baselineTests,
  ...discoverTests(join(root, "tests")),
  ...["customer", "merchant", "captain", "control-panel"].flatMap((app) => [
    ...discoverTests(join(root, "apps", app, "src", "features")),
    ...discoverTests(join(root, "apps", app, "tests")),
  ]),
])].sort();

const command = [
  "--experimental-transform-types",
  "--loader", "./packages/design-system/tools/ts-resolver.mjs",
  "--experimental-test-coverage",
  "--test-reporter=lcov",
  "--test-reporter-destination=coverage/lcov.info",
  "--test", ...testFiles,
];
const testRun = spawnSync(process.execPath, command, { cwd: root, stdio: "inherit" });
if (testRun.error) throw testRun.error;
assert.equal(testRun.status, 0, "Actual source test suite must pass before reporting coverage");
const raw = readFileSync(report, "utf8");
const lcov = raw.split(/\r?\n/).map(line =>
  line.startsWith("SF:") ? `SF:${line.slice(3).replaceAll("\\", "/")}` : line
).join("\n");
const sources = new Set();
let linesHit = 0;
let linesFound = 0;
for (const line of lcov.split("\n")) {
  if (line.startsWith("SF:")) sources.add(line.slice(3));
  if (line.startsWith("LH:")) linesHit += Number(line.slice(3));
  if (line.startsWith("LF:")) linesFound += Number(line.slice(3));
}
for (const source of [
  "tools/governance/verify-foundation.mjs",
  "tools/mobile/verify-app-foundations.mjs",
  "tools/mobile/define-bthwani-expo-app.cjs",
  "packages/design-system/src/semantics/themes.ts",
]) {
  assert.ok(sources.has(source), "Real test coverage missing required source: " + source);
}
assert.ok(linesFound > 0 && linesHit > 0 && linesHit <= linesFound, "Invalid actual coverage");
writeFileSync(report, lcov, "utf8");
console.log(`REAL_SOURCE_LCOV_PASS files=${sources.size} hit=${linesHit} lines=${linesFound} measured_percent=${(100 * linesHit / linesFound).toFixed(1)} other_sources_not_assumed_covered=true`);
