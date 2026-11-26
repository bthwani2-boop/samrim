#!/usr/bin/env node
// One native Node source-test runner, one LCOV writer. Sonar owns analysis
// scope and threshold; the runner preserves measured records, never invents counters.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSourceSnapshot } from "./source-snapshot.mjs";
import { discoverNodeSourceTests, discoverWorkspaceTestSuites } from "./source-test-discovery.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const coverage = join(root, "coverage");
const report = join(coverage, "lcov.info");
const reservation = join(coverage, ".lcov-running");
const nodeOptions = ["--experimental-transform-types", "--loader", "./packages/design-system/tools/ts-resolver.mjs"];
const requiredSources = [
  "tools/mobile/verify-app-identity.mjs",
  "tools/mobile/define-bthwani-expo-app.cjs",
  "packages/design-system/src/semantics/themes.ts",
];

function runNode(args) {
  const result = spawnSync(process.execPath, [...nodeOptions, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Actual source test suite must pass");
}
function workspaceTests() {
  const files = discoverWorkspaceTestSuites(root).source;
  assert.ok(files.length > 0, "No admitted source tests");
  return files;
}
function admittedCandidate(files) {
  const snapshot = captureSourceSnapshot(root);
  assert.ok(!snapshot.unsafeTracked && !snapshot.unsafeUntracked, "TEST_SOURCE_ADMISSION_FAILED");
  const admitted = new Set(snapshot.files);
  for (const file of files) assert.ok(admitted.has(file), "TEST_SOURCE_NOT_ADMITTED " + file);
  return snapshot;
}
function assertUnchanged(before, files) {
  assert.deepEqual(admittedCandidate(files), before, "TEST_SOURCE_CHANGED_DURING_EXECUTION");
}
function projectTests() {
  const folder = resolve(process.cwd());
  const project = relative(root, folder).replaceAll("\\", "/");
  assert.match(project, /^(apps|packages|services)\/[a-zA-Z0-9_-]+$/, "Run --project from a workspace project root");
  const files = discoverNodeSourceTests(root, folder);
  assert.ok(files.length > 0, "No admitted project source tests: " + project);
  const before = admittedCandidate(files);
  runNode(["--test-concurrency=2", "--test", ...files]);
  assertUnchanged(before, discoverNodeSourceTests(root, folder));
}

function operatorRuntimeTests() {
  const files = discoverWorkspaceTestSuites(root).operatorRuntime;
  assert.ok(files.length > 0, "No admitted Operator runtime tests");
  const before = admittedCandidate(files);
  // Tests own their build prerequisites and isolated servers. No environment
  // flag can silently convert this required suite into skipped source tests.
  runNode(["--test-concurrency=1", "--test", ...files]);
  assertUnchanged(before, discoverWorkspaceTestSuites(root).operatorRuntime);
  console.log("OPERATOR_RUNTIME_TESTS_PASS files=" + files.length);
}

// The atomic directory is both the exclusive reservation and the only work
// area for an in-flight report. An interrupted writer is never guessed dead:
// an existing reservation fails closed until its owner/process is reconciled.
function assertDirectory(directory) {
  const info = lstatSync(directory);
  const expected = join(realpathSync.native(root), relative(root, directory));
  assert.ok(info.isDirectory() && !info.isSymbolicLink() &&
    relative(expected, realpathSync.native(directory)) === "", "COVERAGE_DIRECTORY_UNSAFE " + directory);
}
function reserveWriter(operation) {
  mkdirSync(coverage, { recursive: true });
  assertDirectory(coverage);
  try {
    mkdirSync(reservation);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("COVERAGE_WRITER_BUSY: existing reservation " + reservation);
    throw error;
  }
  try {
    assertDirectory(reservation);
    writeFileSync(join(reservation, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { flag: "wx" });
    return operation();
  } finally {
    // Only this invocation acquired the reservation. Never remove a redirected
    // directory or a different writer's work.
    assertDirectory(reservation);
    rmSync(reservation, { recursive: true });
  }
}

function invalidateReport() {
  const info = lstatSync(report, { throwIfNoEntry: false });
  if (!info) return;
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, "COVERAGE_REPORT_UNSAFE " + report);
  unlinkSync(report);
}
function sourceScope() {
  const settings = readFileSync(join(root, "sonar-project.properties"), "utf8");
  function list(key) {
    const lines = settings.split(/\r?\n/).filter(line => line.startsWith(key + "="));
    assert.equal(lines.length, 1, "Expected one Sonar scope property: " + key);
    const values = lines[0].slice(key.length + 1).split(",").map(value => value.trim());
    assert.ok(values.every(value => value && !/[\\{}[\]!]/.test(value)), "Unsupported Sonar scope: " + key);
    return values;
  }
  const sources = list("sonar.sources");
  assert.ok(sources.every(source => /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(source)), "Invalid Sonar source roots");
  const excluded = list("sonar.exclusions");
  return source => sources.some(dir => source.startsWith(dir + "/")) &&
    !excluded.some(pattern => posix.matchesGlob(source, pattern));
}
function counter(lines, source, prefix) {
  const entries = lines.filter(line => line.startsWith(prefix));
  assert.equal(entries.length, 1, "Missing LCOV counter: " + source + " " + prefix);
  const value = entries[0].slice(prefix.length);
  assert.match(value, /^\d+$/, "Invalid LCOV counter: " + source);
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), "Unsafe LCOV counter: " + source);
  return number;
}
function measuredReport(raw, inScope, admitted) {
  assert.ok(raw.trimEnd().endsWith("end_of_record"), "Incomplete LCOV report");
  const records = [];
  const measured = new Set();
  let external = 0, outsideScope = 0, hit = 0, found = 0;
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
    assert.ok(admitted.has(source), "LCOV_SOURCE_NOT_ADMITTED " + source);
    const covered = counter(lines, source, "LH:"), total = counter(lines, source, "LF:");
    assert.ok(covered <= total, "Invalid actual coverage: " + source);
    hit += covered;
    found += total;
    assert.ok(Number.isSafeInteger(hit) && Number.isSafeInteger(found), "Unsafe total LCOV counters");
    measured.add(source);
    // Repeated SF records can represent different native module evaluations.
    // Preserve every record and all original counters for scanner aggregation.
    records.push(lines.map(line => line.startsWith("SF:") ? "SF:" + source : line).join("\n"));
  }
  for (const source of requiredSources) assert.ok(measured.has(source), "Real test coverage missing required source: " + source);
  assert.ok(found > 0 && hit > 0 && hit <= found, "Invalid actual coverage");
  return { records, measured, external, outsideScope, hit, found };
}
function publishCoverage() {
  return reserveWriter(() => {
    // A failed discovery, test or report must leave no previous report that
    // could be mistaken for current evidence. A rejected competing invocation
    // never reaches this operation.
    invalidateReport();
    const files = workspaceTests();
    const before = admittedCandidate(files);
    const inScope = sourceScope();
    const raw = join(reservation, "native.lcov");
    const normalized = join(reservation, "lcov.info");
    runNode([
      "--experimental-test-coverage",
      "--test-concurrency=4",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      "--test-reporter-destination=" + raw,
      "--test", ...files,
    ]);
    assertUnchanged(before, workspaceTests());
    assertDirectory(coverage);
    assertDirectory(reservation);
    const info = lstatSync(raw);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, "Unsafe native LCOV report");
    const { records, measured, external, outsideScope, hit, found } = measuredReport(readFileSync(raw, "utf8"), inScope, new Set(before.files));
    writeFileSync(normalized, records.map(record => record + "\nend_of_record\n").join(""), { encoding: "utf8", flag: "wx" });
    assert.ok(!lstatSync(report, { throwIfNoEntry: false }), "COVERAGE_REPORT_CONFLICT: unexpected publication");
    assertUnchanged(before, workspaceTests());
    renameSync(normalized, report);
    console.log("LCOV_EXTERNAL_RECORDS_EXCLUDED count=" + external);
    console.log("LCOV_SONAR_SCOPE_RECORDS_EXCLUDED count=" + outsideScope);
    console.log("REAL_SOURCE_LCOV_PASS files=" + measured.size + " records=" + records.length + " record_hits=" + hit + " record_lines=" + found + " unique_line_percentage=NOT_COMPUTED scanner_owns_aggregation=true other_sources_not_assumed_covered=true");
  });
}

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && ["--check-discovery", "--project", "--operator-runtime"].includes(args[0])),
  "Usage: node tools/dev/run-coverage.mjs [--check-discovery | --project (from project root) | --operator-runtime]");
switch (args[0]) {
  case "--check-discovery": {
    const suites = discoverWorkspaceTestSuites(root);
    assert.ok(suites.source.length > 0, "No admitted source tests");
    console.log("SOURCE_TEST_DISCOVERY_PASS count=" + (suites.source.length + suites.operatorRuntime.length) +
      " source=" + suites.source.length + " operator_runtime=" + suites.operatorRuntime.length);
    break;
  }
  case "--project":
    projectTests();
    break;
  case "--operator-runtime":
    operatorRuntimeTests();
    break;
  default:
    publishCoverage();
}
