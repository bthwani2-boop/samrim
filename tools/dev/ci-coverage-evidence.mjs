#!/usr/bin/env node
// Native runners own measurements; CI admits only a complete, exact-tree
// artifact set into a fresh scanner destination. No coverage is fabricated.
import assert from "node:assert/strict";
import { appendFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureSourceSnapshot, readVerifiedFile, samePath, sha256 } from "./source-snapshot.mjs";

const specifications = Object.freeze({
  js: { directory: "coverage", artifact: "sonar-js", files: ["lcov.info"] },
  go: { directory: "coverage", artifact: "sonar-go", files: ["dsh-go.out", "identity-go.out", "wlt-go.out"] },
  postgres: { directory: "coverage/owner-postgres", artifact: "sonar-postgres" },
});
const metadata = ["tree.txt", "reports.sha256"];
const objectId = /^[0-9a-f]{40}$/;
const profileName = /^[A-Za-z0-9][A-Za-z0-9._-]*\.out$/;
const maxReportBytes = 128 * 1024 * 1024;
const exists = path => Boolean(lstatSync(path, { throwIfNoEntry: false }));

function requireDirectory(path) {
  const entry = lstatSync(path);
  assert.ok(entry.isDirectory() && !entry.isSymbolicLink() &&
    samePath(realpathSync.native(path), resolve(path)), "CI_COVERAGE_DIRECTORY_UNSAFE");
}

function exactInventory(folder, names, error) {
  const expected = new Set(names);
  const actual = readdirSync(folder);
  assert.ok(actual.length === expected.size && actual.every(name => expected.has(name)), error);
}

function reportBytes(path) {
  const { bytes } = readVerifiedFile(path, maxReportBytes);
  assert.ok(bytes.length > 0, "CI_COVERAGE_REPORT_EMPTY");
  return bytes;
}

function readReports(spec, folder) {
  requireDirectory(folder);
  const names = spec.files ?? readdirSync(folder).filter(name => name.endsWith(".out"));
  assert.ok(names.length > 0 && names.every(name => spec.files || profileName.test(name)),
    "CI_COVERAGE_REPORT_INVENTORY_INVALID");
  // Native PostgreSQL receipts use LC_ALL=C. Admitted names are ASCII;
  // ordinal comparison defines the same locale-independent byte order.
  const ordered = [...names].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return new Map(ordered.map(name => [name, reportBytes(join(folder, name))]));
}

function manifest(files) {
  return Buffer.from([...files].map(([name, bytes]) => sha256(bytes) + " *" + name + "\n").join(""));
}

function committedTree(checkout, expectedSha) {
  assert.match(expectedSha ?? "", objectId, "CI_CANDIDATE_SHA_INVALID");
  const snapshot = captureSourceSnapshot(checkout, { requireCommitted: true });
  assert.equal(snapshot.head, expectedSha, "CI_CANDIDATE_SHA_MISMATCH");
  const tree = snapshot.tree;
  assert.match(tree, objectId, "CI_CANDIDATE_TREE_INVALID");
  return { tree, fingerprint: snapshot.worktree };
}

function writeNew(path, bytes) {
  writeFileSync(path, bytes, { flag: "wx" });
}

export function publishCoverageEvidence(checkout, kind, expectedSha) {
  const spec = Object.hasOwn(specifications, kind) ? specifications[kind] : null;
  assert.ok(spec, "CI_COVERAGE_PRODUCER_UNKNOWN");
  const root = resolve(checkout);
  const candidate = committedTree(root, expectedSha);
  const folder = join(root, spec.directory);
  const files = readReports(spec, folder);
  assert.ok(!exists(join(folder, "tree.txt")), "CI_COVERAGE_METADATA_CONFLICT");
  const receipt = join(folder, "reports.sha256");
  const expectedManifest = manifest(files);
  // Fixed producers have a declared inventory. The native PostgreSQL runner
  // owns its dynamic inventory and seals it at collection, before handoff.
  if (spec.files) {
    assert.ok(!exists(receipt), "CI_COVERAGE_METADATA_CONFLICT");
  } else {
    exactInventory(folder, [...files.keys(), "reports.sha256"], "CI_COVERAGE_REPORT_INVENTORY_INVALID");
    assert.ok(reportBytes(receipt).equals(expectedManifest), "CI_COVERAGE_PRODUCER_HASH_MISMATCH");
  }
  assert.deepEqual(committedTree(root, expectedSha), candidate, "CI_COVERAGE_SOURCE_CHANGED");
  if (spec.files) writeNew(receipt, expectedManifest);
  writeNew(join(folder, "tree.txt"), candidate.tree + "\n");
  return { tree: candidate.tree, count: files.size };
}

function readArtifact(temp, spec) {
  const folder = join(temp, spec.artifact);
  const files = readReports(spec, folder);
  exactInventory(folder, [...files.keys(), ...metadata], "CI_COVERAGE_ARTIFACT_INVENTORY_MISMATCH");
  const tree = reportBytes(join(folder, "tree.txt")).toString("utf8").trim();
  assert.match(tree, objectId, "CI_COVERAGE_ARTIFACT_TREE_INVALID");
  assert.ok(reportBytes(join(folder, "reports.sha256")).equals(manifest(files)),
    "CI_COVERAGE_ARTIFACT_HASH_MISMATCH");
  return { spec, tree, files };
}

// The scanner reads fixed JS/Go filenames and a PostgreSQL wildcard. Checking
// only the incoming filenames is insufficient: an old extra *.out would
// otherwise enter the scanner. The native fresh-coverage fallback likewise
// requires a new PostgreSQL directory. Never remove or reuse existing inputs.
function requireFreshDestination(root) {
  const coverage = join(root, "coverage");
  if (exists(coverage)) requireDirectory(coverage);
  for (const spec of [specifications.js, specifications.go]) {
    for (const name of spec.files) {
      assert.ok(!exists(join(root, spec.directory, name)), "CI_COVERAGE_DESTINATION_CONFLICT");
    }
  }
  assert.ok(!exists(join(root, specifications.postgres.directory)), "CI_COVERAGE_DESTINATION_CONFLICT");
}

function installEvidence(root, evidence) {
  const coverage = join(root, "coverage");
  if (!exists(coverage)) mkdirSync(coverage);
  requireDirectory(coverage);
  // Exclusive creation ensures the wildcard directory cannot contain a
  // previous writer's reports. These paths belong to the isolated CI runner.
  const postgres = join(root, specifications.postgres.directory);
  mkdirSync(postgres);
  requireDirectory(postgres);
  for (const { spec, files } of evidence) {
    const folder = join(root, spec.directory);
    for (const [name, bytes] of files) writeNew(join(folder, name), bytes);
  }
  for (const { spec, files } of evidence) {
    const folder = join(root, spec.directory);
    requireDirectory(folder);
    if (!spec.files) exactInventory(folder, files.keys(), "CI_COVERAGE_DESTINATION_INVENTORY_MISMATCH");
    for (const [name, bytes] of files) {
      assert.ok(reportBytes(join(folder, name)).equals(bytes), "CI_COVERAGE_DESTINATION_HASH_MISMATCH");
    }
  }
}

export function admitCoverageEvidence(checkout, runnerTemp, expectedSha) {
  const root = resolve(checkout);
  const temp = resolve(runnerTemp);
  requireDirectory(temp);
  const candidate = committedTree(root, expectedSha);
  const evidence = Object.values(specifications).map(spec => readArtifact(temp, spec));
  const tree = evidence[0].tree;
  assert.ok(evidence.every(entry => entry.tree === tree), "CI_COVERAGE_MIXED_CANDIDATES");
  // Reject existing scanner inputs before either reuse or fresh measurement.
  // Non-scanner output in the coverage root is not a conflict.
  requireFreshDestination(root);
  if (tree !== candidate.tree) return false;
  assert.deepEqual(committedTree(root, expectedSha), candidate, "CI_COVERAGE_SOURCE_CHANGED");
  installEvidence(root, evidence);
  return true;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [operation, kind, ...rest] = process.argv.slice(2);
  assert.equal(rest.length, 0, "Unexpected coverage evidence arguments");
  if (operation === "publish" && kind) {
    const result = publishCoverageEvidence(process.cwd(), kind, process.env.GITHUB_SHA);
    console.log("CI_COVERAGE_ATTESTED " + kind + " tree=" + result.tree + " reports=" + result.count);
  } else if (operation === "admit" && kind === undefined) {
    assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_OUTPUT, "CI_COVERAGE_ENVIRONMENT_MISSING");
    const reuse = admitCoverageEvidence(process.cwd(), process.env.RUNNER_TEMP, process.env.CI_ANALYSIS_SHA);
    appendFileSync(process.env.GITHUB_OUTPUT, "reuse=" + reuse + "\n");
    console.log("CI_COVERAGE_ADMISSION reuse=" + reuse);
  } else {
    throw new Error("Usage: node tools/dev/ci-coverage-evidence.mjs publish <js|go|postgres> | admit");
  }
}
