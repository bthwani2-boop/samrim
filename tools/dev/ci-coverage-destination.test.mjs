import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { admitCoverageEvidence, publishCoverageEvidence } from "./ci-coverage-evidence.mjs";

// Real filesystem/Git operations; fixture bytes test admission, not coverage.
const profiles = {
  "sonar-js": ["lcov.info"],
  "sonar-go": ["dsh-go.out", "identity-go.out", "wlt-go.out"],
  "sonar-postgres": ["dsh-customercart.test-1.out", "identity-session.test-2.out", "wlt-wallet.test-3.out"],
};
const content = name => "Fixture evidence for " + name + "\n";
const hash = value => createHash("sha256").update(value).digest("hex");
const fixed = [...profiles["sonar-js"], ...profiles["sonar-go"]].map(name => "coverage/" + name);
const destinationProfiles = profiles["sonar-postgres"].map(name => "coverage/owner-postgres/" + name);

function fixture(callback) {
  const base = mkdtempSync(join(tmpdir(), "bthwani-coverage-destination-"));
  const repo = join(base, "repo");
  const artifacts = join(base, "artifacts");
  const put = (file, bytes) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  try {
    mkdirSync(repo);
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
    git("init", "-q", "-b", "fixture");
    git("config", "user.name", "Coverage Fixture");
    git("config", "user.email", "coverage-fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    put(join(repo, ".gitignore"), "coverage/\n");
    put(join(repo, "source.txt"), "original source\n");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const sha = git("rev-parse", "HEAD");
    const tree = git("rev-parse", "HEAD^{tree}");
    put(join(repo, "source.txt"), "alternate source\n");
    git("add", "source.txt");
    const otherTree = git("write-tree");
    git("restore", "--staged", "--worktree", "source.txt");
    assert.notEqual(tree, otherTree);
    const artifactsFor = candidateTree => {
      for (const [artifact, names] of Object.entries(profiles)) {
        const folder = join(artifacts, artifact);
        for (const name of names) put(join(folder, name), content(name));
        put(join(folder, "tree.txt"), candidateTree + "\n");
        put(join(folder, "reports.sha256"), [...names].sort()
          .map(name => hash(content(name)) + " *" + name + "\n").join(""));
      }
    };
    artifactsFor(tree);
    const admit = () => admitCoverageEvidence(repo, artifacts, sha);
    const assertMissing = except => {
      for (const file of [...fixed, ...destinationProfiles]) {
        if (file !== except) assert.equal(existsSync(join(repo, file)), false, file);
      }
    };
    return callback({ repo, sha, tree, otherTree, artifactsFor, put, admit, assertMissing });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("exact-tree admission rejects an extra stale PostgreSQL wildcard report before any publication", () => fixture(({ repo, put, admit, assertMissing }) => {
  const stale = join(repo, "coverage/owner-postgres/stale.out");
  put(stale, "protected stale report\n");
  assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
  assertMissing();
  assert.deepEqual(readdirSync(dirname(stale)), ["stale.out"]);
  assert.equal(readFileSync(stale, "utf8"), "protected stale report\n");
}));

test("a different valid tree cannot enter fresh measurement with any existing scanner destination", () => {
  for (const path of [...fixed, "coverage/owner-postgres/extra.out"]) {
    fixture(({ repo, otherTree, artifactsFor, put, admit, assertMissing }) => {
      artifactsFor(otherTree);
      put(join(repo, path), "existing output\n");
      assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
      assertMissing(path);
      assert.equal(readFileSync(join(repo, path), "utf8"), "existing output\n");
    });
  }
});

test("matching evidence publishes only the exact scanner inventory and preserves unrelated output", () => fixture(({ repo, put, admit }) => {
  put(join(repo, "coverage/unrelated.txt"), "keep\n");
  assert.equal(admit(), true);
  for (const file of [...fixed, ...destinationProfiles]) {
    assert.equal(readFileSync(join(repo, file), "utf8"), content(file.split("/").at(-1)));
  }
  assert.deepEqual(readdirSync(join(repo, "coverage/owner-postgres")).sort(), [...profiles["sonar-postgres"]].sort());
  assert.equal(readFileSync(join(repo, "coverage/unrelated.txt"), "utf8"), "keep\n");
  assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
}));

test("different valid evidence requests remeasurement without creating any destination", () => fixture(({ repo, otherTree, artifactsFor, admit, assertMissing }) => {
  artifactsFor(otherTree);
  assert.equal(admit(), false);
  assertMissing();
  assert.equal(existsSync(join(repo, "coverage")), false);
}));

test("a PostgreSQL destination link is rejected without modifying its target", () => fixture(({ repo, put, admit, assertMissing }) => {
  const outside = join(repo, "coverage/elsewhere");
  put(join(outside, "protected.out"), "preserve\n");
  symlinkSync(outside, join(repo, "coverage/owner-postgres"), "junction");
  assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
  assertMissing();
  assert.deepEqual(readdirSync(outside), ["protected.out"]);
  assert.equal(readFileSync(join(outside, "protected.out"), "utf8"), "preserve\n");
}));

test("PostgreSQL producer rejects unrelated files in its dedicated profile inventory", () => fixture(({ repo, sha, put }) => {
  const folder = "coverage/owner-postgres/";
  put(join(repo, folder, "identity-session.test-1.out"), "fixture report\n");
  put(join(repo, folder, "unexpected.txt"), "unexpected\n");
  assert.throws(() => publishCoverageEvidence(repo, "postgres", sha), /CI_COVERAGE_REPORT_INVENTORY_INVALID/);
  for (const name of ["tree.txt", "reports.sha256"]) assert.equal(existsSync(join(repo, folder, name)), false);
}));
