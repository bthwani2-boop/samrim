#!/usr/bin/env node
// The single CI coverage attestation and admission boundary. Native test
// runners own measurements; this module never constructs coverage counters.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureSourceSnapshot, readVerifiedFile, samePath, sha256 } from "./source-snapshot.mjs";

const specifications = Object.freeze({
  js: { directory: "coverage", artifact: "sonar-js", files: ["lcov.info"] },
  go: { directory: "coverage", artifact: "sonar-go", files: ["dsh-go.out", "identity-go.out", "wlt-go.out"] },
  postgres: { directory: "coverage/owner-postgres", artifact: "sonar-postgres" },
});
const commitPattern = /^[0-9a-f]{40}$/;
const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.out$/;
const maxReportBytes = 128 * 1024 * 1024;

function directory(path, create = false) {
  if (create && !lstatSync(path, { throwIfNoEntry: false })) mkdirSync(path);
  const info = lstatSync(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() &&
    samePath(realpathSync.native(path), resolve(path)), "CI_COVERAGE_DIRECTORY_UNSAFE");
}

function reportBytes(path) {
  const { bytes } = readVerifiedFile(path, maxReportBytes);
  assert.ok(bytes.length > 0, "CI_COVERAGE_REPORT_EMPTY");
  return bytes;
}

// Report filenames are canonical ASCII identifiers, not locale-sensitive
// presentation labels. Exact set equality rejects missing and extra artifacts.
const compareName = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function reports(spec, folder) {
  directory(folder);
  const names = spec.files ?? readdirSync(folder).filter(name => name.endsWith(".out"));
  assert.ok(names.length > 0 && names.every(name => spec.files || profilePattern.test(name)),
    "CI_COVERAGE_REPORT_INVENTORY_INVALID");
  return new Map([...names].sort(compareName).map(name => [name, reportBytes(join(folder, name))]));
}

function manifest(files) {
  return Buffer.from([...files].map(([name, bytes]) => sha256(bytes) + " *" + name + "\n").join(""));
}

function committedTree(checkout, expectedSha) {
  assert.match(expectedSha ?? "", commitPattern, "CI_CANDIDATE_SHA_INVALID");
  const snapshot = captureSourceSnapshot(checkout, { requireCommitted: true });
  assert.equal(snapshot.head, expectedSha, "CI_CANDIDATE_SHA_MISMATCH");
  const tree = execFileSync(process.platform === "win32" ? "git.exe" : "git",
    ["rev-parse", expectedSha + "^{tree}"], {
      cwd: checkout, encoding: "utf8", timeout: 10000, windowsHide: true,
    }).trim();
  assert.match(tree, commitPattern, "CI_CANDIDATE_TREE_INVALID");
  return { tree, fingerprint: snapshot.worktree };
}

function writeNew(path, contents) {
  writeFileSync(path, contents, { flag: "wx" });
}

export function publishCoverageEvidence(checkout, kind, expectedSha) {
  const spec = Object.hasOwn(specifications, kind) ? specifications[kind] : null;
  assert.ok(spec, "CI_COVERAGE_PRODUCER_UNKNOWN");
  const root = resolve(checkout);
  const candidate = committedTree(root, expectedSha);
  const { tree } = candidate;
  const folder = join(root, spec.directory);
  const files = reports(spec, folder);
  for (const name of ["tree.txt", "reports.sha256"]) {
    assert.ok(!lstatSync(join(folder, name), { throwIfNoEntry: false }), "CI_COVERAGE_METADATA_CONFLICT");
  }
  assert.deepEqual(committedTree(root, expectedSha), candidate, "CI_COVERAGE_SOURCE_CHANGED");
  writeNew(join(folder, "tree.txt"), tree + "\n");
  writeNew(join(folder, "reports.sha256"), manifest(files));
  return { tree, count: files.size };
}

function readArtifact(temp, spec) {
  const folder = join(temp, spec.artifact);
  const files = reports(spec, folder);
  const expected = new Set([...files.keys(), "reports.sha256", "tree.txt"]);
  const actual = readdirSync(folder);
  assert.ok(actual.length === expected.size && actual.every(name => expected.has(name)), "CI_COVERAGE_ARTIFACT_INVENTORY_MISMATCH");
  const tree = reportBytes(join(folder, "tree.txt")).toString("utf8").trim();
  assert.match(tree, commitPattern, "CI_COVERAGE_ARTIFACT_TREE_INVALID");
  assert.ok(reportBytes(join(folder, "reports.sha256")).equals(manifest(files)),
    "CI_COVERAGE_ARTIFACT_HASH_MISMATCH");
  return { tree, files };
}

export function admitCoverageEvidence(checkout, runnerTemp, expectedSha) {
  const root = resolve(checkout);
  const temp = resolve(runnerTemp);
  directory(temp);
  const candidate = committedTree(root, expectedSha);
  // Validate every report before admitting any. A real different PR tree is
  // not corruption: remeasure it through the existing native runners.
  const evidence = Object.values(specifications).map(spec => ({ spec, ...readArtifact(temp, spec) }));
  const tree = evidence[0].tree;
  assert.ok(evidence.every(entry => entry.tree === tree), "CI_COVERAGE_MIXED_CANDIDATES");
  if (tree !== candidate.tree) return false;
  directory(join(root, "coverage"), true);
  directory(join(root, "coverage", "owner-postgres"), true);
  for (const { spec, files } of evidence) {
    const folder = join(root, spec.directory);
    for (const name of files.keys()) {
      assert.ok(!lstatSync(join(folder, name), { throwIfNoEntry: false }), "CI_COVERAGE_DESTINATION_CONFLICT");
    }
  }
  assert.deepEqual(committedTree(root, expectedSha), candidate, "CI_COVERAGE_SOURCE_CHANGED");
  for (const { spec, files } of evidence) {
    for (const [name, bytes] of files) writeNew(join(root, spec.directory, name), bytes);
  }
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
