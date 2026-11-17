#!/usr/bin/env node
// Report coverage actually observed by the pinned Node test runner.
// Sonar owns the acceptance threshold; missing reports or failed tests fail closed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

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
  "tools/dev/source-test-discovery.test.mjs",
  "tools/mobile/verify-native-config.test.mjs",
];

// Every test candidate in supported feature/journey paths is either run or rejected.
const testFiles = [...new Set([
  ...baselineTests,
  ...discoverWorkspaceNodeTests(root),
])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
for (const file of baselineTests) {
  assert.ok(existsSync(join(root, file)), `Missing baseline test ${file}`);
}
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--check-discovery")) {
  throw new Error("Usage: node tools/dev/run-coverage.mjs [--check-discovery]");
}
if (process.argv[2] === "--check-discovery") {
  console.log(`SOURCE_TEST_DISCOVERY_PASS count=${testFiles.length}`);
  process.exit(0);
}

const command = [
  "--experimental-transform-types",
  "--loader", "./packages/design-system/tools/ts-resolver.mjs",
  "--experimental-test-coverage",
  "--test-concurrency=4",
  // Keep failures visible in CI while writing machine-readable LCOV.
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
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
  assert.ok(sources.has(source), `Real test coverage missing required source: ${source}`);
}
assert.ok(linesFound > 0 && linesHit > 0 && linesHit <= linesFound, "Invalid actual coverage");
writeFileSync(report, lcov, "utf8");
console.log(`REAL_SOURCE_LCOV_PASS files=${sources.size} hit=${linesHit} lines=${linesFound} measured_percent=${(100 * linesHit / linesFound).toFixed(1)} other_sources_not_assumed_covered=true`);
