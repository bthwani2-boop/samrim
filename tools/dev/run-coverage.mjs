#!/usr/bin/env node
// Native Node test execution and one atomic, non-overwriting LCOV publisher.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, lstatSync, mkdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSourceSnapshot, readVerifiedFile, samePath } from "./source-snapshot.mjs";
import { discoverNodeSourceTests, discoverWindowsPlatformTests, discoverWorkspaceTestSuites } from "./source-test-discovery.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const coverage = join(root, "coverage");
const report = join(coverage, "lcov.info");
const reservation = join(coverage, ".lcov-running");
const ownerFile = join(reservation, "owner.json");
const pendingReport = join(reservation, "lcov.info");
const maxReportBytes = 128 * 1024 * 1024;
const nodeOptions = ["--experimental-transform-types", "--import", "./packages/design-system/tools/ts-resolver.mjs"];
const requiredSources = [
  "tools/mobile/verify-app-identity.mjs",
  "tools/mobile/define-bthwani-expo-app.cjs",
  "packages/design-system/src/semantics/themes.ts",
];

function nativeTests(files, concurrency, measure = false) {
  assert.ok(files.length, "No admitted source tests");
  const reporters = measure ? [
    "--experimental-test-coverage", "--test-reporter=spec", "--test-reporter-destination=stderr",
    "--test-reporter=lcov", "--test-reporter-destination=stdout",
  ] : [];
  // The native LCOV reporter writes only to the inherited pipe. No child
  // test receives an intermediate report pathname that it can substitute.
  const result = spawnSync(process.execPath, [...nodeOptions, "--test-concurrency=" + concurrency,
    ...reporters, "--test", ...files], {
    cwd: root, stdio: measure ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: maxReportBytes,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Actual source test suite must pass");
  return measure ? result.stdout.toString("utf8") : undefined;
}

function sourceFiles() {
  return discoverWorkspaceTestSuites(root).source;
}

function candidate(files) {
  assert.ok(files.length, "No admitted source tests");
  const snapshot = captureSourceSnapshot(root);
  assert.ok(!snapshot.unsafeTracked && !snapshot.unsafeUntracked, "TEST_SOURCE_ADMISSION_FAILED");
  const admitted = new Set(snapshot.files);
  for (const file of files) assert.ok(admitted.has(file), "TEST_SOURCE_NOT_ADMITTED " + file);
  return snapshot;
}

function checkCandidate(before, inventory) {
  assert.deepEqual(candidate(inventory()), before, "TEST_SOURCE_CHANGED_DURING_EXECUTION");
}

function testSuite(inventory, concurrency, measure = false) {
  const files = inventory();
  const before = candidate(files);
  const output = nativeTests(files, concurrency, measure);
  checkCandidate(before, inventory);
  return { before, output, count: files.length };
}

function projectInventory() {
  const folder = resolve(process.cwd());
  const project = relative(root, folder).replaceAll("\\", "/");
  assert.match(project, /^(apps|packages|services)\/[a-zA-Z0-9_-]+$/, "Run --project from a workspace project root");
  return discoverNodeSourceTests(root, folder);
}

function directoryIdentity(directory) {
  const entry = lstatSync(directory, { bigint: true });
  const expected = join(realpathSync.native(root), relative(root, directory));
  assert.ok(entry.isDirectory() && !entry.isSymbolicLink() &&
    samePath(expected, realpathSync.native(directory)), "COVERAGE_DIRECTORY_UNSAFE " + directory);
  return { dev: entry.dev, ino: entry.ino };
}

function unlinkIfPresent(file) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function withPublication(operation) {
  mkdirSync(coverage, { recursive: true });
  const parent = directoryIdentity(coverage);
  try {
    mkdirSync(reservation);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("COVERAGE_WRITER_BUSY: existing reservation " + reservation);
    throw error;
  }
  const identity = directoryIdentity(reservation);
  const checkDirectories = () => {
    assert.deepEqual(directoryIdentity(coverage), parent, "COVERAGE_DIRECTORY_CHANGED");
    assert.deepEqual(directoryIdentity(reservation), identity, "COVERAGE_RESERVATION_CHANGED");
  };
  let ownsMarker = false;
  let ownsPending = false;
  try {
    writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { flag: "wx" });
    ownsMarker = true;
    // Unlink only the old report entry; never truncate or follow a leaf link.
    // Refuse a redirected or unsupported entry rather than remove unknown work.
    checkDirectories();
    const previous = lstatSync(report, { throwIfNoEntry: false });
    if (previous) {
      assert.ok(previous.isFile() && !previous.isSymbolicLink() && previous.nlink === 1, "COVERAGE_REPORT_UNSAFE " + report);
      unlinkIfPresent(report);
    }
    return operation((bytes, verify) => {
      checkDirectories();
      verify();
      writeFileSync(pendingReport, bytes, { flag: "wx" });
      ownsPending = true;
      checkDirectories();
      assert.ok(readVerifiedFile(pendingReport, maxReportBytes).bytes.equals(bytes), "COVERAGE_PENDING_CHANGED");
      // Atomic create-if-absent on the same filesystem. Never replace another
      // writer's destination even if it appears after earlier checks.
      try {
        linkSync(pendingReport, report);
      } catch (error) {
        if (error.code === "EEXIST") throw new Error("COVERAGE_REPORT_CONFLICT: unexpected publication");
        throw error;
      }
      unlinkSync(pendingReport);
      ownsPending = false;
      assert.ok(readVerifiedFile(report, maxReportBytes).bytes.equals(bytes), "COVERAGE_REPORT_CHANGED");
    });
  } finally {
    // No recursive deletion of unknown files or replacement directories.
    checkDirectories();
    if (ownsPending) unlinkIfPresent(pendingReport);
    if (ownsMarker) unlinkIfPresent(ownerFile);
    rmdirSync(reservation);
  }
}

function sonarScope() {
  const source = readVerifiedFile(join(root, "sonar-project.properties"), 1024 * 1024).bytes.toString("utf8");
  const list = key => {
    const matches = source.split(/\r?\n/).filter(line => line.startsWith(key + "="));
    assert.equal(matches.length, 1, "Expected one Sonar scope property: " + key);
    const values = matches[0].slice(key.length + 1).split(",").map(value => value.trim());
    assert.ok(values.every(value => value && !/[\\{}[\]!]/.test(value)), "Unsupported Sonar scope: " + key);
    return values;
  };
  const roots = list("sonar.sources");
  assert.ok(roots.every(value => /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value)), "Invalid Sonar source roots");
  const exclusions = list("sonar.exclusions");
  return file => roots.some(dir => file.startsWith(dir + "/")) &&
    !exclusions.some(pattern => posix.matchesGlob(file, pattern));
}

function counter(lines, source, prefix) {
  const values = lines.filter(line => line.startsWith(prefix));
  assert.equal(values.length, 1, "Missing LCOV counter: " + source + " " + prefix);
  const value = values[0].slice(prefix.length);
  assert.match(value, /^\d+$/, "Invalid LCOV counter: " + source);
  const count = Number(value);
  assert.ok(Number.isSafeInteger(count), "Unsafe LCOV counter: " + source);
  return count;
}

function normalizeLCOV(raw, scope, admitted) {
  assert.ok(raw.trimEnd().endsWith("end_of_record"), "Incomplete LCOV report");
  const records = [];
  const measured = new Set();
  let external = 0, outsideScope = 0, hit = 0, found = 0;
  for (const record of raw.split(/^end_of_record\r?$/m)) {
    const lines = record.split(/\r?\n/).filter(Boolean);
    if (!lines.length) continue;
    const paths = lines.filter(line => line.startsWith("SF:"));
    assert.equal(paths.length, 1, "Invalid LCOV source record");
    const file = relative(root, resolve(root, paths[0].slice(3).replaceAll("\\", "/"))).replaceAll("\\", "/");
    if (isAbsolute(file) || file === ".." || file.startsWith("../")) {
      external++;
      continue;
    }
    assert.ok(file, "Invalid LCOV source path");
    if (!scope(file)) {
      outsideScope++;
      continue;
    }
    assert.ok(admitted.has(file), "LCOV_SOURCE_NOT_ADMITTED " + file);
    const covered = counter(lines, file, "LH:");
    const total = counter(lines, file, "LF:");
    assert.ok(covered <= total, "Invalid actual coverage: " + file);
    hit += covered;
    found += total;
    assert.ok(Number.isSafeInteger(hit) && Number.isSafeInteger(found), "Unsafe total LCOV counters");
    measured.add(file);
    // Preserve every measured record, including repeated evaluations. Sonar
    // owns aggregation and thresholds; no counter is generated here.
    records.push(lines.map(line => line.startsWith("SF:") ? "SF:" + file : line).join("\n") + "\nend_of_record\n");
  }
  for (const file of requiredSources) assert.ok(measured.has(file), "Real test coverage missing required source: " + file);
  assert.ok(found > 0 && hit > 0 && hit <= found, "Invalid actual coverage");
  return { bytes: Buffer.from(records.join("")), count: measured.size, records: records.length, external, outsideScope, hit, found };
}

function publishCoverage() {
  withPublication(publish => {
    const files = sourceFiles();
    const before = candidate(files);
    const scope = sonarScope();
    const raw = nativeTests(files, 4, true);
    checkCandidate(before, sourceFiles);
    const result = normalizeLCOV(raw, scope, new Set(before.files));
    assert.ok(result.bytes.length <= maxReportBytes, "Normalized LCOV exceeds bounded report size");
    publish(result.bytes, () => checkCandidate(before, sourceFiles));
    console.log("LCOV_EXTERNAL_RECORDS_EXCLUDED count=" + result.external);
    console.log("LCOV_SONAR_SCOPE_RECORDS_EXCLUDED count=" + result.outsideScope);
    console.log("REAL_SOURCE_LCOV_PASS files=" + result.count + " records=" + result.records +
      " record_hits=" + result.hit + " record_lines=" + result.found +
      " unique_line_percentage=NOT_COMPUTED scanner_owns_aggregation=true other_sources_not_assumed_covered=true");
  });
}

function main(args) {
  assert.ok(args.length === 0 || (args.length === 1 && ["--check-discovery", "--project", "--operator-runtime", "--windows-platform"].includes(args[0])),
    "Usage: node tools/dev/run-coverage.mjs [--check-discovery | --project (from project root) | --operator-runtime | --windows-platform]");
  switch (args[0]) {
    case "--check-discovery": {
      const suites = discoverWorkspaceTestSuites(root);
      assert.ok(suites.source.length, "No admitted source tests");
      console.log("SOURCE_TEST_DISCOVERY_PASS count=" + (suites.source.length + suites.operatorRuntime.length) +
        " source=" + suites.source.length + " operator_runtime=" + suites.operatorRuntime.length);
      break;
    }
    case "--project":
      testSuite(projectInventory, 2);
      break;
    case "--operator-runtime": {
      const result = testSuite(() => discoverWorkspaceTestSuites(root).operatorRuntime, 1);
      console.log("OPERATOR_RUNTIME_TESTS_PASS files=" + result.count);
      break;
    }
    case "--windows-platform": {
      assert.equal(process.platform, "win32", "Windows platform tests require Windows");
      const result = testSuite(() => discoverWindowsPlatformTests(root), 2);
      console.log("WINDOWS_PLATFORM_TESTS_PASS files=" + result.count + " powershell_coverage=NOT_MEASURED graphify_optional_integration=SEPARATE");
      break;
    }
    default:
      publishCoverage();
  }
}

main(process.argv.slice(2));
