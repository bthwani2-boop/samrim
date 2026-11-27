import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { admitCoverageEvidence, publishCoverageEvidence } from "./ci-coverage-evidence.mjs";

// Real filesystem/Git operations; fixture bytes test admission, not coverage.
const producers = [
  { kind: "js", artifact: "sonar-js", directory: "coverage", files: ["lcov.info"] },
  { kind: "go", artifact: "sonar-go", directory: "coverage", files: ["dsh-go.out", "identity-go.out", "wlt-go.out"] },
  { kind: "postgres", artifact: "sonar-postgres", directory: "coverage/owner-postgres", files: ["dsh-customercart.test-1.out", "identity-session.test-2.out", "wlt-wallet.test-3.out"] },
];
const [jsProducer, goProducer, postgresProducer] = producers;
const content = name => "Fixture evidence for " + name + "\n";
const bash = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
function independentManifest(directory, names) {
  return execFileSync(bash, ["-c", 'set -o pipefail; sha256sum --binary -- "$@" | LC_ALL=C sort -k2,2', "native-manifest", ...names],
    { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 30000 }).replaceAll("\r\n", "\n");
}
const fixed = [jsProducer, goProducer].flatMap(({ directory, files }) => files.map(name => directory + "/" + name));
const destinationProfiles = postgresProducer.files.map(name => postgresProducer.directory + "/" + name);

function fixture(callback) {
  const base = mkdtempSync(join(tmpdir(), "bthwani-ci-coverage-"));
  const repo = join(base, "repo");
  const artifacts = join(base, "artifacts");
  const put = (file, bytes) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  try {
    mkdirSync(repo);
    const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=" + join(base, "no-hooks"), ...args], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 30000 }).trim();
    git("init", "-q", "-b", "fixture");
    git("config", "user.name", "Coverage Fixture");
    git("config", "user.email", "coverage-fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    put(join(repo, ".gitattributes"), "* text=auto eol=lf\n");
    put(join(repo, ".gitignore"), "coverage/\n");
    put(join(repo, "source.txt"), "original source\n");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const sha = git("rev-parse", "HEAD");
    const tree = git("rev-parse", "HEAD^{tree}");
    const otherTree = () => {
      put(join(repo, "source.txt"), "alternate source\n");
      git("add", "--", "source.txt");
      const alternate = git("write-tree");
      git("restore", "--staged", "--worktree", "source.txt");
      assert.notEqual(tree, alternate);
      return alternate;
    };
    const artifactsFor = candidateTree => {
      for (const { artifact, files } of producers) {
        const folder = join(artifacts, artifact);
        for (const name of files) put(join(folder, name), content(name));
        put(join(folder, "tree.txt"), candidateTree + "\n");
        // Synthetic input bytes are deterministic; the native independent
        // sha256sum oracle is used separately for each real producer assertion.
        put(join(folder, "reports.sha256"), [...files].sort()
          .map(name => createHash("sha256").update(content(name)).digest("hex") + " *" + name + "\n").join(""));
      }
    };
    const admit = (expectedSha = sha) => admitCoverageEvidence(repo, artifacts, expectedSha);
    const assertMissing = except => {
      for (const file of [...fixed, ...destinationProfiles]) {
        if (file !== except) assert.equal(existsSync(join(repo, file)), false, file);
      }
    };
    return callback({ repo, git, sha, tree, otherTree, artifacts, artifactsFor, put, admit, assertMissing });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("exact-tree admission rejects an extra stale PostgreSQL wildcard report before any publication", () => fixture(({ repo, tree, artifactsFor, put, admit, assertMissing }) => {
  artifactsFor(tree);
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
      artifactsFor(otherTree());
      put(join(repo, path), "existing output\n");
      assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
      assertMissing(path);
      assert.equal(readFileSync(join(repo, path), "utf8"), "existing output\n");
    });
  }
});

test("matching evidence publishes only the exact scanner inventory and preserves unrelated output", () => fixture(({ repo, tree, artifactsFor, put, admit }) => {
  artifactsFor(tree);
  put(join(repo, "coverage/unrelated.txt"), "keep\n");
  assert.equal(admit(), true);
  for (const file of [...fixed, ...destinationProfiles]) {
    assert.equal(readFileSync(join(repo, file), "utf8"), content(file.split("/").at(-1)));
  }
  assert.deepEqual(readdirSync(join(repo, "coverage/owner-postgres")).sort(), [...postgresProducer.files].sort());
  assert.equal(readFileSync(join(repo, "coverage/unrelated.txt"), "utf8"), "keep\n");
  assert.throws(admit, /CI_COVERAGE_DESTINATION_CONFLICT/);
}));

test("different valid evidence requests remeasurement without creating any destination", () => fixture(({ repo, otherTree, artifactsFor, admit, assertMissing }) => {
  artifactsFor(otherTree());
  assert.equal(admit(), false);
  assertMissing();
  assert.equal(existsSync(join(repo, "coverage")), false);
}));

test("a PostgreSQL destination link is rejected without modifying its target", () => fixture(({ repo, tree, artifactsFor, put, admit, assertMissing }) => {
  artifactsFor(tree);
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

test("PostgreSQL attestation cannot reconstruct missing native evidence", () => fixture(({ repo, sha, put }) => {
  const folder = join(repo, postgresProducer.directory);
  for (const name of postgresProducer.files) put(join(folder, name), content(name));
  rmSync(join(folder, postgresProducer.files[0]));
  assert.throws(() => publishCoverageEvidence(repo, "postgres", sha), /CI_COVERAGE_REPORT_INVENTORY_INVALID/);
  assert.equal(existsSync(join(folder, "tree.txt")), false);
  assert.equal(existsSync(join(folder, "reports.sha256")), false);
}));

for (const defect of ["missing", "changed", "extra"]) {
  test("PostgreSQL attestation rejects " + defect + " profile after native collection", () => fixture(({ repo, sha, put }) => {
    const folder = join(repo, postgresProducer.directory);
    const files = postgresProducer.files;
    for (const name of files) put(join(folder, name), content(name));
    const receipt = join(folder, "reports.sha256");
    const sealed = independentManifest(folder, files);
    put(receipt, sealed);
    if (defect === "missing") rmSync(join(folder, files[0]));
    else if (defect === "changed") put(join(folder, files[0]), "changed\n");
    else put(join(folder, "extra.out"), "extra\n");
    assert.throws(() => publishCoverageEvidence(repo, "postgres", sha), /CI_COVERAGE_PRODUCER_HASH_MISMATCH/);
    assert.equal(existsSync(join(folder, "tree.txt")), false);
    assert.equal(readFileSync(receipt, "utf8"), sealed);
  }));
}

for (const { kind, artifact, directory, files } of producers) {
  test(artifact + " attests exact committed source and rejects hidden, staged, dirty and empty inputs", () => fixture(({ repo, git, sha, tree, put }) => {
    const folder = join(repo, directory);
    for (const name of files) put(join(folder, name), content(name));
    const receipt = join(folder, "reports.sha256");
    const sealed = independentManifest(folder, files);
    if (kind === "postgres") put(receipt, sealed);
    const publish = () => publishCoverageEvidence(repo, kind, sha);
    assert.deepEqual(publish(), { tree, count: files.length });
    assert.equal(readFileSync(join(folder, "tree.txt"), "utf8").trim(), tree);
    assert.equal(readFileSync(join(folder, "reports.sha256"), "utf8"), independentManifest(folder, files));
    assert.throws(publish, /CI_COVERAGE_METADATA_CONFLICT/);
    rmSync(join(folder, "tree.txt"));
    if (kind !== "postgres") rmSync(receipt);
    assert.throws(() => publishCoverageEvidence(repo, kind, "0".repeat(40)), /CI_CANDIDATE_SHA_MISMATCH/);
    const reject = () => assert.throws(publish, /CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED/);
    const untracked = join(repo, "untracked-source.test.mjs");
    put(untracked, "export {};\n");
    reject();
    git("add", "--", "untracked-source.test.mjs");
    reject();
    git("rm", "--cached", "--", "untracked-source.test.mjs");
    rmSync(untracked);
    put(join(repo, "source.txt"), "dirty\n");
    reject();
    git("add", "--", "source.txt");
    put(join(repo, "source.txt"), "original source\n");
    reject();
    git("restore", "--staged", "--worktree", "source.txt");
    for (const flag of ["assume-unchanged", "skip-worktree"]) {
      git("update-index", "--" + flag, "--", "source.txt");
      put(join(repo, "source.txt"), "hidden source\n");
      assert.equal(git("status", "--porcelain", "--", "source.txt"), "");
      reject();
      put(join(repo, "source.txt"), "original source\n");
      git("update-index", "--no-" + flag, "--", "source.txt");
      git("restore", "--worktree", "--", "source.txt");
      assert.equal(git("status", "--porcelain"), "");
    }
    put(join(folder, files[0]), "");
    assert.throws(publish, /CI_COVERAGE_REPORT_EMPTY/);
    assert.equal(existsSync(join(folder, "tree.txt")), false);
    if (kind === "postgres") assert.equal(readFileSync(receipt, "utf8"), sealed);
    else assert.equal(existsSync(receipt), false);
  }));
}

const firstProfile = postgresProducer.artifact + "/" + postgresProducer.files[0];
const invalidArtifacts = [
  { name: "missing tree stamp", omit: "sonar-go/tree.txt" },
  { name: "missing Go report", omit: "sonar-go/dsh-go.out" },
  { name: "missing PostgreSQL profile", omit: firstProfile },
  { name: "missing PostgreSQL manifest", omit: "sonar-postgres/reports.sha256" },
  { name: "altered JS report", replace: "sonar-js/lcov.info", value: "changed\n" },
  { name: "altered Go report", replace: "sonar-go/identity-go.out", value: "changed\n" },
  { name: "altered PostgreSQL profile", replace: firstProfile, value: "changed\n" },
  { name: "unexpected PostgreSQL profile", replace: "sonar-postgres/unexpected.out", value: "extra\n" },
  { name: "unexpected Go report", replace: "sonar-go/extra.out", value: "extra\n" },
  { name: "empty JS report", replace: "sonar-js/lcov.info", value: "" },
  { name: "empty PostgreSQL profile", replace: firstProfile, value: "" },
];
for (const scenario of invalidArtifacts) {
  test("admission rejects " + scenario.name + " before any publication", () => fixture(({ tree, artifacts, artifactsFor, put, admit, assertMissing }) => {
    artifactsFor(tree);
    if (scenario.omit) rmSync(join(artifacts, scenario.omit));
    else put(join(artifacts, scenario.replace), scenario.value);
    assert.throws(admit);
    assertMissing();
  }));
}

test("admission rejects mixed and invalid producer tree stamps", () => fixture(({ tree, otherTree, artifacts, artifactsFor, put, admit, assertMissing }) => {
  artifactsFor(tree);
  put(join(artifacts, "sonar-postgres/tree.txt"), otherTree() + "\n");
  assert.throws(admit, /CI_COVERAGE_MIXED_CANDIDATES/);
  assertMissing();
  put(join(artifacts, "sonar-postgres/tree.txt"), "invalid-tree\n");
  assert.throws(admit, /CI_COVERAGE_ARTIFACT_TREE_INVALID/);
  assertMissing();
}));

test("admission rejects wrong SHA, dirty and hidden analysis source before publication", () => fixture(({ repo, git, tree, artifactsFor, put, admit, assertMissing }) => {
  artifactsFor(tree);
  assert.throws(() => admit("0".repeat(40)), /CI_CANDIDATE_SHA_MISMATCH/);
  assertMissing();
  const untracked = join(repo, "untracked.mjs");
  put(untracked, "export {};\n");
  assert.throws(admit, /CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED/);
  assertMissing();
  rmSync(untracked);
  git("update-index", "--assume-unchanged", "--", "source.txt");
  put(join(repo, "source.txt"), "hidden changed source\n");
  assert.equal(git("status", "--porcelain", "--", "source.txt"), "");
  assert.throws(admit, /CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED/);
  assertMissing();
}));

test("native receipt order is explicit ASCII byte order, independent of enumeration and locale", () => fixture(({ repo, sha, put }) => {
  const folder = join(repo, postgresProducer.directory);
  const names = ["zeta-2.out", "alpha_1.out", "Beta-10.out", "beta-2.out", "0zero.out", "a-1.out"];
  for (const name of names) put(join(folder, name), content(name));
  const expected = ["0zero.out", "Beta-10.out", "a-1.out", "alpha_1.out", "beta-2.out", "zeta-2.out"];
  const receipt = independentManifest(folder, names);
  assert.deepEqual(receipt.trimEnd().split("\n").map(line => line.slice(66)), expected);
  put(join(folder, "reports.sha256"), receipt);
  assert.equal(publishCoverageEvidence(repo, "postgres", sha).count, names.length);
  assert.equal(readFileSync(join(folder, "reports.sha256"), "utf8"), receipt);
}));
