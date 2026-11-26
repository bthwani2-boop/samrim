#!/usr/bin/env node
// Node executes every admitted source test. Sonar owns analysis scope and threshold.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const report = join(root, "coverage/lcov.info");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--check-discovery"),
  "Usage: node tools/dev/run-coverage.mjs [--check-discovery]");
const discoveryOnly = args.length === 1;
if (!discoveryOnly) rmSync(report, { force: true });
const files = discoverWorkspaceNodeTests(root);
assert.ok(files.length > 0, "No admitted source tests");
if (discoveryOnly) {
  console.log(`SOURCE_TEST_DISCOVERY_PASS count=${files.length}`);
  process.exit(0);
}

// Use the same authored source scope as the Sonar scanner. This filters whole
// records only, never counters, and cannot broaden or waive its Quality Gate.
const settings = readFileSync(join(root, "sonar-project.properties"), "utf8");
function list(key) {
  const lines = settings.split(/\r?\n/).filter(line => line.startsWith(key + "="));
  assert.equal(lines.length, 1, "Expected one Sonar scope property: " + key);
  const values = lines[0].slice(key.length + 1).split(",").map(value => value.trim());
  assert.ok(values.every(value => value && !/[\\{}\[\]!]/.test(value)), "Unsupported Sonar scope: " + key);
  return values;
}
const sources = list("sonar.sources");
assert.ok(sources.every(source => /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(source)), "Invalid Sonar source roots");
const excluded = list("sonar.exclusions");
const inScope = source => sources.some(dir => source.startsWith(dir + "/")) &&
  !excluded.some(pattern => posix.matchesGlob(source, pattern));

mkdirSync(dirname(report), { recursive: true });
const scratch = mkdtempSync(join(dirname(report), ".lcov-"));
const candidate = join(scratch, "lcov.info");
try {
  const result = spawnSync(process.execPath, [
    "--experimental-transform-types",
    "--loader", "./packages/design-system/tools/ts-resolver.mjs",
    "--experimental-test-coverage",
    "--test-concurrency=4",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${candidate}`,
    "--test", ...files,
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Actual source test suite must pass before reporting coverage");

  const records = [];
  const measured = new Set();
  let external = 0, outsideScope = 0, hit = 0, found = 0;
  const raw = readFileSync(candidate, "utf8");
  assert.ok(raw.trimEnd().endsWith("end_of_record"), "Incomplete LCOV report");
  for (const record of raw.split(/^end_of_record\r?$/m)) {
    const lines = record.split(/\r?\n/).filter(Boolean);
    if (!lines.length) continue;
    const sourceLines = lines.filter(line => line.startsWith("SF:"));
    assert.equal(sourceLines.length, 1, "Invalid LCOV source record");
    const source = relative(root, resolve(root, sourceLines[0].slice(3).replaceAll("\\", "/"))).replaceAll("\\", "/");
    if (isAbsolute(source) || source === ".." || source.startsWith("../")) {
      external++;
      continue;
    }
    assert.ok(source, "Invalid LCOV source path");
    if (!inScope(source)) {
      outsideScope++;
      continue;
    }
    assert.ok(!measured.has(source), "Duplicate LCOV source: " + source);
    measured.add(source);
    const count = prefix => {
      const entries = lines.filter(line => line.startsWith(prefix));
      assert.equal(entries.length, 1, "Missing LCOV counter: " + source + " " + prefix);
      const value = entries[0].slice(prefix.length);
      assert.match(value, /^\d+$/, "Invalid LCOV counter: " + source);
      const number = Number(value);
      assert.ok(Number.isSafeInteger(number), "Unsafe LCOV counter: " + source);
      return number;
    };
    const covered = count("LH:"), total = count("LF:");
    assert.ok(covered <= total, "Invalid actual coverage: " + source);
    hit += covered;
    found += total;
    records.push(lines.map(line => line.startsWith("SF:") ? "SF:" + source : line).join("\n"));
  }
  for (const source of [
    "tools/mobile/verify-app-foundations.mjs",
    "tools/mobile/define-bthwani-expo-app.cjs",
    "packages/design-system/src/semantics/themes.ts",
  ]) assert.ok(measured.has(source), "Real test coverage missing required source: " + source);
  assert.ok(found > 0 && hit > 0 && hit <= found, "Invalid actual coverage");
  writeFileSync(candidate, records.map(record => record + "\nend_of_record\n").join(""), "utf8");
  renameSync(candidate, report);
  console.log(`LCOV_EXTERNAL_RECORDS_EXCLUDED count=${external}`);
  console.log(`LCOV_SONAR_SCOPE_RECORDS_EXCLUDED count=${outsideScope}`);
  console.log(`REAL_SOURCE_LCOV_PASS files=${measured.size} hit=${hit} lines=${found} measured_percent=${(100 * hit / found).toFixed(1)} other_sources_not_assumed_covered=true`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
