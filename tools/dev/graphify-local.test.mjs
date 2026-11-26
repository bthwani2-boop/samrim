import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndex, inspectGraphSources } from "./graphify-local.mjs";

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

test("tracked and untracked source bytes are admitted through one real-file boundary", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-admission-"));
  const entry = name => "100644 "+"a".repeat(40)+" 0\t"+name;
  try {
    mkdirSync(join(dir,"apps"));
    const file = join(dir,"apps","new.ts");
    writeFileSync(file,"export const n=1;");
    const tracked = [entry("apps/new.ts")];
    const first = inspectGraphSources(dir, tracked, []);
    assert.deepEqual(first.unsafeTracked, []);
    assert.deepEqual(first.unsafeUntracked, []);
    writeFileSync(file,"export const n=2;");
    assert.notEqual(inspectGraphSources(dir,tracked,[]).digest,first.digest);
    assert.notEqual(inspectGraphSources(dir,[],["apps/new.ts"]).digest,first.digest);
    writeFileSync(join(dir,"apps",".env"),"SYNTHETIC=1");
    assert.deepEqual(inspectGraphSources(dir,[entry("apps/.env")],[]).unsafeTracked,["apps/.env"]);
    assert.deepEqual(inspectGraphSources(dir,[],["apps/.env"]).unsafeUntracked,["apps/.env"]);
    writeFileSync(file,"const key = 'sk_"+"live_"+"A".repeat(16)+"';");
    assert.deepEqual(inspectGraphSources(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    writeFileSync(file,"export const n=3;");
    linkSync(file,join(dir,"apps","alias.ts"));
    assert.deepEqual(inspectGraphSources(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    rmSync(join(dir,"apps","alias.ts"));
    symlinkSync(dir,join(dir,"apps","linked"),process.platform==="win32"?"junction":"dir");
    assert.deepEqual(inspectGraphSources(dir,[entry("apps/linked/apps/new.ts")],[]).unsafeTracked,["apps/linked/apps/new.ts"]);
    assert.deepEqual(inspectGraphSources(dir,[],["../outside.ts"]).unsafeUntracked,["../outside.ts"]);
    assert.deepEqual(inspectGraphSources(dir,["120000 "+"a".repeat(40)+" 0\tapps/new.ts"],[]).unsafeTracked,["apps/new.ts"]);
    rmSync(file);
    const removed=inspectGraphSources(dir,tracked,[]);
    assert.deepEqual(removed.unsafeTracked,[]);
    assert.notEqual(removed.digest,first.digest);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("automatic sync refreshes safe dirty and clean known checkouts and handles same-HEAD branch changes", async () => {
  const runner = await import("./graphify-local.mjs");
  assert.equal(typeof runner.planSync, "function");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false }, "indexed-graph"), "current");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false, head: "next" }, "indexed-graph"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false, branch: "other-dev" }, "indexed-graph"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: false }, "changed"), "refresh");
  assert.equal(runner.planSync(indexed, { ...current, dirty: true, worktree: "dirty" }, "indexed-graph"), "refresh");
  assert.throws(() => runner.planSync(indexed, { ...current, dirty: false, repository: "d:/foreign" }, "indexed-graph"), /repository differs/);
  assert.throws(() => runner.planSync(null, current, "indexed-graph"), /unverified/);
});

test("one exclusive lock covers the complete sync and is released on failure", async () => {
  const runner = await import("./graphify-local.mjs");
  const { mkdtempSync, existsSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-lock-test-"));
  const lock = join(dir, "refresh.lock");
  try {
    assert.equal(typeof runner.withRefreshLock, "function");
    assert.throws(() => runner.withRefreshLock(lock, () => {
      assert.equal(existsSync(lock), true);
      const owner = JSON.parse(readFileSync(lock, "utf8"));
      assert.equal(owner.pid, process.pid);
      assert.equal(owner.version, 1);
      assert.ok(Number.isFinite(Date.parse(owner.startedAt)));
      assert.throws(() => runner.withRefreshLock(lock, () => assert.fail("second writer")), /BLOCKED.*refresh/);
      assert.deepEqual(JSON.parse(readFileSync(lock, "utf8")), owner);
      throw new Error("simulated rebuild error");
    }), /simulated rebuild error/);
    assert.equal(existsSync(lock), false);
    assert.equal(runner.withRefreshLock(lock, () => "ok"), "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reviewed lock recovery preserves evidence and refuses a live or changed lock", async () => {
  const runner = await import("./graphify-local.mjs");
  const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "graphify-recover-test-"));
  const lock = join(dir, "refresh.lock");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  try {
    runner.withRefreshLock(lock, () => {
      const hash = digest(readFileSync(lock));
      assert.throws(() => runner.recoverRefreshLock(lock, hash, () => {}), /BLOCKED.*owner/);
      assert.equal(existsSync(lock), true);
    });
    writeFileSync(lock, "");
    const legacy = digest(readFileSync(lock));
    assert.throws(() => runner.recoverRefreshLock(lock, "0".repeat(64), () => {}), /BLOCKED.*changed/);
    assert.throws(() => runner.recoverRefreshLock(lock, legacy, () => { throw new Error("BLOCKED: native writer"); }), /native writer/);
    assert.equal(existsSync(lock), true);
    const saved = runner.recoverRefreshLock(lock, legacy, () => {});
    assert.equal(existsSync(lock), false);
    assert.equal(readFileSync(saved, "utf8"), "");
    assert.equal(runner.withRefreshLock(lock, () => "ok"), "ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a terminated lock owner leaves durable recovery evidence, without authorizing a concurrent writer", { timeout: 15000 }, async () => {
  const runner = await import("./graphify-local.mjs");
  const { mkdtempSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const dir = mkdtempSync(join(tmpdir(), "graphify-crashed-owner-"));
  const lock = join(dir, "refresh.lock");
  const script = `import { withRefreshLock } from ${JSON.stringify(new URL("./graphify-local.mjs", import.meta.url).href)};
    withRefreshLock(process.argv[1], () => { process.stdout.write("locked"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000); });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, lock], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const closed = once(child, "exit");
  try {
    const [chunk] = await once(child.stdout, "data");
    assert.equal(chunk.toString(), "locked");
    const bytes = readFileSync(lock);
    assert.equal(JSON.parse(bytes).pid, child.pid);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.throws(() => runner.recoverRefreshLock(lock, hash, () => {}), /BLOCKED.*owner/);
    assert.throws(() => runner.withRefreshLock(lock, () => assert.fail("concurrent refresh")), /BLOCKED.*refresh/);
    child.kill("SIGKILL");
    await closed;
    assert.equal(existsSync(lock), true);
    const saved = runner.recoverRefreshLock(lock, hash, () => {});
    assert.deepEqual(readFileSync(saved), bytes);
    assert.equal(runner.withRefreshLock(lock, () => "recovered"), "recovered");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await closed;
    }
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
    mkdirSync(join(dir, "tools", "security"), { recursive: true });
    writeFileSync(join(dir, "tools", "security", "verify-secrets.mjs"), readFileSync(new URL("../security/verify-secrets.mjs", import.meta.url)));
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
    const measured = JSON.parse(cli(["coverage", "example.ts"]));
    assert.equal(measured.coverage, "PASS");
    assert.equal(measured.coverageKind, "FILE_NODE_MEMBERSHIP_ONLY");
    assert.deepEqual(measured.represented, ["example.ts"]);
    assert.equal(measured.head, first.head);
    assert.equal(measured.indexedHead, first.head);
    assert.match(measured.graphSha256, /^[a-f0-9]{64}$/);
    assert.match(measured.sourceFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(cli(["coverage", "missing.ts"], 2)).unadmitted, ["missing.ts"]);
    cli(["coverage", "../outside.ts"], 2);
    // A hard link to another file is not an admitted existing hook.
    const hookPath = join(dir, ".git", "hooks", "post-commit");
    const outsideHook = join(dir, "graphify-out", "unrelated-hook");
    writeFileSync(outsideHook, "#!/bin/sh\n# graphify-hook-start\nold\n# graphify-hook-end\n");
    const { linkSync } = await import("node:fs");
    linkSync(outsideHook, hookPath);
    cli(["install-hooks"], 2);
    assert.equal(readFileSync(hookPath, "utf8"), readFileSync(outsideHook, "utf8"));
    rmSync(hookPath);
    cli(["install-hooks"]);
    git("switch", "-c", "fixture-b");
    assert.equal(proof().head, first.head);
    writeFileSync(join(dir, "example.ts"), "export function example() { return 2; }\n");
    const seedPath = join(dir, "graphify-out", ".candidate", "graph.json");
    const outsideSeed = join(dir, "graphify-out", "unrelated-seed");
    writeFileSync(outsideSeed, "must not overwrite");
    rmSync(seedPath);
    linkSync(outsideSeed, seedPath);
    cli(["sync"], 2);
    assert.equal(readFileSync(outsideSeed, "utf8"), "must not overwrite");
    rmSync(seedPath);
    cli(["sync"]);
    assert.equal(proof().dirty, true);
    git("update-index", "--assume-unchanged", "example.ts");
    cli(["sync"]);
    proof();
    const assumed=JSON.parse(cli(["coverage","example.ts"]));
    writeFileSync(join(dir,"example.ts"),"export function example() { return 3; }\n");
    assert.equal(git("status","--porcelain","--","example.ts"),"");
    assert.equal(JSON.parse(cli(["status"])).status,"INVALIDATED");
    assert.notEqual(JSON.parse(cli(["coverage","example.ts"],2)).sourceFingerprint,assumed.sourceFingerprint);
    git("update-index","--no-assume-unchanged","example.ts");
    cli(["sync"]);
    mkdirSync(join(dir, "apps"));
    const added = join(dir, "apps", "new.ts");
    writeFileSync(added, "export function newGraphFixture() { return 1; }\n");
    cli(["sync"]);
    assert.ok(JSON.parse(readFileSync(join(dir,"graphify-out","graph.json"),"utf8")).nodes.some(n=>String(n.label).includes("newGraphFixture")));
    assert.equal(JSON.parse(cli(["coverage", "apps/new.ts"])).coverage, "PASS");
    writeFileSync(added, "export function changedNewGraphFixture() { return 2; }\n");
    assert.equal(JSON.parse(cli(["status"])).status,"INVALIDATED");
    assert.equal(JSON.parse(cli(["coverage", "apps/new.ts"], 2)).coverage, "INVALIDATED");
    cli(["sync"]);
    proof();
    rmSync(added);
    cli(["sync"]);
    assert.ok(!JSON.parse(readFileSync(join(dir,"graphify-out","graph.json"),"utf8")).nodes.some(n=>String(n.label).includes("changedNewGraphFixture")));
    assert.deepEqual(JSON.parse(cli(["coverage", "apps/new.ts"], 2)).unadmitted, ["apps/new.ts"]);
    git("add", "example.ts");
    git("commit", "-m", "fixture update");
    assert.notEqual(proof().head, first.head);
    cli(["query", "example"]);
    const verified = readFileSync(stamp, "utf8");
    const wrong = { ...JSON.parse(verified), repository: "foreign" };
    writeFileSync(stamp, JSON.stringify(wrong));
    cli(["sync"], 2);
    cli(["status"], 2);
    assert.equal(JSON.parse(cli(["coverage", "example.ts"], 2)).coverage, "BLOCKED");
    assert.equal(JSON.parse(readFileSync(stamp, "utf8")).repository, "foreign");
    writeFileSync(stamp, verified);
    proof();
    const lock = join(dir, "graphify-out", ".local-refresh.lock");
    writeFileSync(lock, "");
    cli(["sync"], 2);
    cli(["query", "example"]);
    rmSync(lock);
    proof();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit graph coverage reports exact authored paths, not labels or duplicate nodes", async () => {
  const { measureFileCoverage } = await import("./graphify-local.mjs");
  assert.equal(typeof measureFileCoverage, "function", "missing scoped graph coverage");
  const authored = new Set(["tools/a.mjs", "tools/b.mjs"]);
  const nodes = [
    { source_file: "tools/a.mjs" },
    { source_file: "tools/a.mjs" },
    { label: "tools/b.mjs" },
    { source_file: "tools/deleted.mjs" },
  ];
  assert.deepEqual(measureFileCoverage(["tools/a.mjs"], authored, nodes), {
    coverage: "PASS", requested: ["tools/a.mjs"], represented: ["tools/a.mjs"],
    missing: [], unadmitted: [],
  });
  assert.deepEqual(measureFileCoverage(["tools/a.mjs", "tools/b.mjs", "tools/deleted.mjs"], authored, nodes), {
    coverage: "FAIL", requested: ["tools/a.mjs", "tools/b.mjs", "tools/deleted.mjs"],
    represented: ["tools/a.mjs"], missing: ["tools/b.mjs"], unadmitted: ["tools/deleted.mjs"],
  });
});

test("explicit graph coverage rejects ambiguous or unsafe path scopes and malformed graphs", async () => {
  const { measureFileCoverage } = await import("./graphify-local.mjs");
  assert.equal(typeof measureFileCoverage, "function", "missing scoped graph coverage");
  for (const paths of [[], ["../outside.ts"], ["C:/outside.ts"], ["./tools/a.mjs"], ["tools\\a.mjs"],
    ["tools/a.mjs", "tools/a.mjs"], ["tools/.env"]]) {
    assert.throws(() => measureFileCoverage(paths, new Set(), []), /coverage scope/i);
  }
  assert.throws(() => measureFileCoverage(["tools/a.mjs"], new Set(["tools/a.mjs"]), null), /graph nodes/i);
});

test("reviewed recovery refuses a hard-linked lock before inspecting ownership", async () => {
  const { recoverRefreshLock } = await import("./graphify-local.mjs");
  const { mkdtempSync, writeFileSync, linkSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "graphify-linked-lock-"));
  try {
    const original = join(dir, "original"), lock = join(dir, "refresh.lock");
    writeFileSync(original, "");
    linkSync(original, lock);
    const digest = createHash("sha256").update("").digest("hex");
    assert.throws(() => recoverRefreshLock(lock, digest, () => assert.fail("unsafe lock")), /BLOCKED.*unsafe/);
    assert.equal(existsSync(lock), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("native Windows spelling resolves only to the same authored physical file", {skip:process.platform!=="win32"}, async () => {
  const { measureFileCoverage } = await import("./graphify-local.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir=mkdtempSync(join(tmpdir(),"graphify-coverage-case-"));
  try {
    mkdirSync(join(dir,"tools"));
    writeFileSync(join(dir,"tools","Start-AppTunnel.ps1"),"Write-Output 'test'\n");
    const paths=["tools/Start-AppTunnel.ps1","tools/compose.yaml"];
    const authored=new Set(paths);
    const result=measureFileCoverage(paths,authored,[{source_file:"tools/start-apptunnel.ps1"},{label:"tools/compose.yaml"}],dir);
    assert.deepEqual(result.represented,["tools/Start-AppTunnel.ps1"]);
    assert.deepEqual(result.missing,["tools/compose.yaml"]);
    assert.equal(result.coverage,"FAIL");
    assert.equal(measureFileCoverage([paths[0]],authored,[{source_file:"tools/start-apptunnel.ps1"}],dir).coverage,"PASS");
    assert.equal(measureFileCoverage([paths[0]],authored,[{source_file:"../tools/start-apptunnel.ps1"}],dir).coverage,"FAIL");
    assert.equal(measureFileCoverage([paths[0]],new Set(),[{source_file:"tools/start-apptunnel.ps1"}],dir).coverage,"FAIL");
    rmSync(join(dir,"tools","Start-AppTunnel.ps1"));
    assert.equal(measureFileCoverage([paths[0]],authored,[{source_file:"tools/start-apptunnel.ps1"}],dir).coverage,"FAIL");
  } finally {rmSync(dir,{recursive:true,force:true});}
});
