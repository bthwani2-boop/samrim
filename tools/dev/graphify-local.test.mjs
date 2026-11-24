import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndex, rejectUntrackedFiles } from "./graphify-local.mjs";

const current = {
  repository: "d:/samrim",
  branch: "codex/close-as-you-go-20261120",
  head: "8661b0602f6fdc6988075594bfb48b3c556afe7c",
  worktree: "clean-fingerprint",
};
const indexed = {
  version: 1,
  ...current,
  graphSha256: "indexed-graph",
};

test("a verified graph is queryable when repository, branch, HEAD, edits and digest match", () => {
  assert.deepEqual(evaluateIndex(indexed, current, "indexed-graph"), {
    status: "PASS",
    queryable: true,
    reason: null,
  });
});

test("missing or incompatible index provenance blocks a query", () => {
  for (const value of [null, { ...indexed, version: 0 }]) {
    const result = evaluateIndex(value, current, "indexed-graph");
    assert.equal(result.queryable, false);
    assert.equal(result.status, "BLOCKED");
  }
});

for (const [field, different] of [
  ["repository", "d:/another-repo"],
  ["branch", "main"],
]) {
  test("a different " + field + " must not be queried as the active checkout", () => {
    const result = evaluateIndex(indexed, { ...current, [field]: different }, "indexed-graph");
    assert.equal(result.queryable, false);
    assert.equal(result.status, "BLOCKED");
  });
}

test("a newer local HEAD does not block querying the older graph", () => {
  const result = evaluateIndex(indexed, { ...current, head: "new-commit" }, "indexed-graph");
  assert.equal(result.queryable, true);
  assert.equal(result.status, "INVALIDATED");
  assert.match(result.reason, /HEAD/);
});

for (const kind of ["modified", "staged", "untracked"]) {
  test(kind + " files do not block read-only Graphify queries", () => {
    const result = evaluateIndex(indexed, { ...current, worktree: kind + "-snapshot" }, "indexed-graph");
    assert.equal(result.queryable, true);
    assert.equal(result.status, "INVALIDATED");
    assert.match(result.reason, /local tracked, staged or untracked/);
  });
}

test("a graph changed by a post-commit hook remains queryable with unverified revision", () => {
  const result = evaluateIndex(indexed, current, "hook-rewritten-graph");
  assert.equal(result.queryable, true);
  assert.equal(result.status, "INVALIDATED");
  assert.match(result.reason, /graph changed/);
});

test("combined source and graph changes preserve all coverage warnings", () => {
  const result = evaluateIndex(indexed, { ...current, head: "next-commit", worktree: "dirty" }, "other-digest");
  assert.equal(result.queryable, true);
  assert.match(result.reason, /graph changed/);
  assert.match(result.reason, /HEAD/);
  assert.match(result.reason, /local tracked/);
});

test("untracked symlinks are not opened by queries and still prevent unsafe refresh", () => {
  assert.doesNotThrow(() => rejectUntrackedFiles([]));
  assert.throws(() => rejectUntrackedFiles(["user-supplied.ts"]), /BLOCKED: review untracked/);
  assert.throws(() => rejectUntrackedFiles(["symlink-to-outside"]), /BLOCKED: review untracked/);
});

test("automatic sync refreshes only a clean known checkout and handles same-HEAD branch changes", async () => {
  const runner = await import("./graphify-local.mjs");
  assert.equal(typeof runner.planSync, "function");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false }, "indexed-graph"), "current");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false, head: "next" }, "indexed-graph"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false, branch: "other-dev" }, "indexed-graph"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false }, "changed"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: true, worktree: "dirty" }, "indexed-graph"), "deferred");
  assert.throws(() => runner.planSync(indexed, { ...current, dirty: false, repository: "d:/foreign" }, "indexed-graph"), /repository differs/);
  assert.throws(() => runner.planSync(null, current, "indexed-graph"), /unverified/);
});

test("one exclusive lock covers the complete sync and is released on failure", async () => {
  const runner = await import("./graphify-local.mjs");
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-lock-test-"));
  const lock = join(dir, "refresh.lock");
  try {
    assert.equal(typeof runner.withRefreshLock, "function");
    assert.throws(() => runner.withRefreshLock(lock, () => {
      assert.equal(existsSync(lock), true);
      assert.throws(() => runner.withRefreshLock(lock, () => assert.fail("second writer")), /BLOCKED.*refresh/);
      throw new Error("simulated rebuild error");
    }), /simulated rebuild error/);
    assert.equal(existsSync(lock), false);
    assert.equal(runner.withRefreshLock(lock, () => "ok"), "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing Graphify hooks are replaceable but unrelated or mixed hooks are protected", async () => {
  const runner = await import("./graphify-local.mjs");
  assert.equal(typeof runner.canReplaceHook, "function");
  assert.equal(runner.canReplaceHook(null, "post-commit"), true);
  assert.equal(runner.canReplaceHook("#!/bin/sh\n# graphify-hook-start\nold\n# graphify-hook-end\n", "post-commit"), true);
  assert.equal(runner.canReplaceHook("#!/bin/sh\n# graphify-checkout-hook-start\nold\n# graphify-checkout-hook-end\n", "post-checkout"), true);
  assert.equal(runner.canReplaceHook("#!/bin/sh\n# graphify-hook-start\nold\n# graphify-hook-end\nother-command\n", "post-commit"), false);
  assert.equal(runner.canReplaceHook("#!/bin/sh\nother-command\n", "post-merge"), false);
  const hook = runner.hookSource("post-checkout");
  assert.equal(runner.canReplaceHook(hook, "post-checkout"), true);
  assert.match(hook, /graphify-local\.mjs sync/);
  assert.doesNotMatch(hook, /PREV_HEAD|NEW_HEAD/);
});

test("real Git events synchronize a local Graphify index in an isolated repository", {
  skip: process.env.BTHWANI_GRAPHIFY_INTEGRATION !== "1",
  timeout: 240000,
}, async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "bthwani-graphify-integration-"));
  const script = "tools/dev/graphify-local.mjs";
  const stamp = join(dir, "graphify-out", "local-index-state.json");
  const gitExe = process.platform === "win32" ? "git.exe" : "git";
  const run = (command, args, expected = 0) => {
    const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", timeout: 180000, windowsHide: true });
    assert.equal(result.status, expected, [command, ...args, result.stdout, result.stderr, result.error].join("\n"));
    return result.stdout.trim();
  };
  const git = (...args) => run(gitExe, args);
  const cli = (args, expected = 0) => run(process.execPath, [script, ...args], expected);
  const proof = () => {
    const status = JSON.parse(cli(["status"]));
    assert.equal(status.status, "PASS");
    assert.equal(status.queryable, true);
    assert.equal(status.head, git("rev-parse", "HEAD"));
    assert.equal(status.indexedHead, status.head);
    assert.equal(status.branch, git("branch", "--show-current"));
    return status;
  };
  try {
    mkdirSync(join(dir, "tools", "dev"), { recursive: true });
    mkdirSync(join(dir, "graphify-out"));
    writeFileSync(join(dir, script), readFileSync(new URL("./graphify-local.mjs", import.meta.url)));
    writeFileSync(join(dir, ".gitignore"), "graphify-out/\n");
    writeFileSync(join(dir, "example.ts"), "export function example() { return 1; }\n");
    git("init", "-b", "fixture-a");
    git("config", "user.name", "Graphify fixture");
    git("config", "user.email", "graphify-fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("add", ".gitignore", script, "example.ts");
    git("commit", "-m", "fixture initial");
    cli(["refresh"]);
    const first = proof();
    cli(["install-hooks"]);
    git("switch", "-c", "fixture-b");
    assert.equal(proof().head, first.head);
    writeFileSync(join(dir, "example.ts"), "export function example() { return 2; }\n");
    const before = readFileSync(stamp, "utf8");
    cli(["sync"], 2);
    assert.equal(readFileSync(stamp, "utf8"), before);
    git("add", "example.ts");
    git("commit", "-m", "fixture update");
    assert.notEqual(proof().head, first.head);
    cli(["query", "example"]);
    const verified = readFileSync(stamp, "utf8");
    const wrong = { ...JSON.parse(verified), repository: "foreign" };
    writeFileSync(stamp, JSON.stringify(wrong));
    cli(["sync"], 2);
    cli(["status"], 2);
    assert.equal(JSON.parse(readFileSync(stamp, "utf8")).repository, "foreign");
    writeFileSync(stamp, verified);
    proof();
    const lock = join(dir, "graphify-out", ".local-refresh.lock");
    writeFileSync(lock, "");
    cli(["sync"], 2);
    cli(["query", "example"], 2);
    rmSync(lock);
    proof();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
