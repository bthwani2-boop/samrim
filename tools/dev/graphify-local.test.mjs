import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIndex } from "./graphify-local.mjs";
import { inspectSourceFiles } from "./source-snapshot.mjs";

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

test("unverified graph bytes are blocked even if the checkout identity is unchanged", () => {
  const result = evaluateIndex(indexed, current, "foreign-graph");
  assert.equal(result.queryable, false);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /graph changed/);
  assert.equal(evaluateIndex(indexed, current, null).queryable, false);
});

test("source drift retains a verified graph but never admits a mismatched graph digest", () => {
  const changed = { ...current, head: "next-commit", worktree: "dirty" };
  const result = evaluateIndex(indexed, changed, "indexed-graph");
  assert.equal(result.queryable, true);
  assert.match(result.reason, /HEAD/);
  assert.match(result.reason, /local tracked/);
  assert.equal(evaluateIndex(indexed, changed, "other-digest").queryable, false);
});

test("ambiguous native interruption retains ownership until reviewed recovery", async () => {
  const runner = await import("./graphify-local.mjs");
  const { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-ambiguous-native-"));
  const lock = join(dir, "refresh.lock");
  try {
    const interruption = Object.assign(new Error("native timeout"), { preserveRefreshLock: true });
    assert.throws(() => runner.withRefreshLock(lock, () => { throw interruption; }), /native timeout/);
    assert.equal(existsSync(lock), true);
    const bytes = readFileSync(lock);
    assert.equal(JSON.parse(bytes).pid, process.pid);
    assert.throws(() => runner.withScheduledRefreshLock(lock, () => assert.fail("second writer"), () => assert.fail("live owner must block")), /BLOCKED.*owner/);
    assert.deepEqual(readFileSync(lock), bytes);
    assert.deepEqual(readdirSync(dir), ["refresh.lock"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    const first = inspectSourceFiles(dir, tracked, []);
    assert.deepEqual(first.unsafeTracked, []);
    assert.deepEqual(first.unsafeUntracked, []);
    writeFileSync(file,"export const n=2;");
    assert.notEqual(inspectSourceFiles(dir,tracked,[]).digest,first.digest);
    assert.notEqual(inspectSourceFiles(dir,[],["apps/new.ts"]).digest,first.digest);
    writeFileSync(join(dir,"apps",".env"),"SYNTHETIC=1");
    assert.deepEqual(inspectSourceFiles(dir,[entry("apps/.env")],[]).unsafeTracked,["apps/.env"]);
    assert.deepEqual(inspectSourceFiles(dir,[],["apps/.env"]).unsafeUntracked,["apps/.env"]);
    writeFileSync(file,"const key = 'sk_"+"live_"+"A".repeat(16)+"';");
    assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    writeFileSync(file,"export const n=3;");
    linkSync(file,join(dir,"apps","alias.ts"));
    assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    rmSync(join(dir,"apps","alias.ts"));
    symlinkSync(dir,join(dir,"apps","linked"),process.platform==="win32"?"junction":"dir");
    assert.deepEqual(inspectSourceFiles(dir,[entry("apps/linked/apps/new.ts")],[]).unsafeTracked,["apps/linked/apps/new.ts"]);
    assert.deepEqual(inspectSourceFiles(dir,[],["../outside.ts"]).unsafeUntracked,["../outside.ts"]);
    assert.deepEqual(inspectSourceFiles(dir,["120000 "+"a".repeat(40)+" 0\tapps/new.ts"],[]).unsafeTracked,["apps/new.ts"]);
    rmSync(file);
    const removed=inspectSourceFiles(dir,tracked,[]);
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
  const { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } = await import("node:fs");
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
    assert.throws(() => runner.withScheduledRefreshLock(lock, () => assert.fail("unverified native writer"), () => { throw new Error("BLOCKED: native writer"); }), /native writer/);
    assert.deepEqual(readFileSync(lock), bytes);
    assert.equal(runner.withScheduledRefreshLock(lock, () => "recovered", () => assert.ok(child.exitCode !== null || child.signalCode !== null)), "recovered");
    assert.equal(existsSync(lock), false);
    const saved = readdirSync(dir).find(name => name.startsWith("refresh.lock.recovered-"));
    assert.deepEqual(readFileSync(join(dir, saved)), bytes);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await closed;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Git events never write the local index; the sole sync path reconciles changes", {
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
    writeFileSync(join(dir,"tools/dev/source-snapshot.mjs"),readFileSync(new URL("./source-snapshot.mjs",import.meta.url)));
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
    const publishedGraph = join(dir, "graphify-out", "graph.json");
    const originalGraph = JSON.parse(readFileSync(publishedGraph, "utf8"));
    originalGraph.nodes.push({ id: "foreignGraphFixture", label: "foreignGraphFixture", source_file: "foreign.ts" });
    writeFileSync(publishedGraph, JSON.stringify(originalGraph));
    assert.equal(JSON.parse(cli(["status"], 2)).status, "BLOCKED");
    cli(["query", "foreignGraphFixture"], 2);
    cli(["sync"]);
    assert.ok(!JSON.parse(readFileSync(publishedGraph, "utf8")).nodes.some(n => n.id === "foreignGraphFixture"));
    proof();
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
    const { linkSync } = await import("node:fs");
    cli(["install-hooks"], 2);
    git("switch", "-c", "fixture-b");
    assert.equal(JSON.parse(cli(["status"], 2)).status, "BLOCKED");
    cli(["sync"]);
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
    const beforeCommit = readFileSync(stamp, "utf8");
    git("commit", "-m", "fixture update");
    assert.equal(readFileSync(stamp, "utf8"), beforeCommit);
    assert.equal(JSON.parse(cli(["status"])).status, "INVALIDATED");
    cli(["sync"]);
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

test("native Windows spelling resolves only to the same authored physical file", { skip: process.platform !== "win32" }, async () => {
  const { measureFileCoverage } = await import("./graphify-local.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, lstatSync, linkSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-coverage-case-"));
  try {
    mkdirSync(join(dir, "tools"));
    const original = "tools/Start-AppTunnel.ps1";
    const alias = "tools/start-apptunnel.ps1";
    writeFileSync(join(dir, original), "Write-Output 'test'\n");
    const authored = new Set([original, "tools/compose.yaml"]);
    const check = (path, source) => measureFileCoverage([path], authored, [{ source_file: source }], dir).coverage;

    // Establish actual file identity rather than assuming that every Windows
    // volume/directory uses case-insensitive lookup.
    const originalStat = lstatSync(join(dir, original), { bigint: true });
    const aliasStat = lstatSync(join(dir, alias), { bigint: true, throwIfNoEntry: false });
    const sameFile = aliasStat?.dev === originalStat.dev && aliasStat?.ino === originalStat.ino;
    assert.notEqual(originalStat.ino, 0n);
    assert.equal(check(original, original), "PASS");
    assert.equal(check(original, alias), sameFile ? "PASS" : "FAIL");
    if (!sameFile) {
      writeFileSync(join(dir, alias), "different physical file\n", { flag: "wx" });
      assert.equal(check(original, alias), "FAIL");
      rmSync(join(dir, alias));
    }

    const result = measureFileCoverage([...authored], authored,
      [{ source_file: alias }, { label: "tools/compose.yaml" }], dir);
    assert.deepEqual(result.represented, sameFile ? [original] : []);
    assert.deepEqual(result.missing, sameFile ? ["tools/compose.yaml"] : [...authored]);
    assert.equal(result.coverage, "FAIL");
    assert.equal(check(original, "../" + alias), "FAIL");
    assert.equal(measureFileCoverage([original], new Set(), [{ source_file: original }], dir).coverage, "FAIL");

    const linked = join(dir, "other.ps1");
    linkSync(join(dir, original), linked);
    assert.equal(check(original, original), "FAIL", "Hard-linked source is not admitted");
    assert.equal(check(original, alias), "FAIL");
    rmSync(linked);
    assert.equal(check(original, original), "PASS");
    rmSync(join(dir, original));
    assert.equal(check(original, original), "FAIL");
    assert.equal(check(original, alias), "FAIL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Graphify recovery admits verified Surface identity without environment metadata but rejects spoofed or foreign identity", async () => {
  const { assertRecoverySource } = await import("./graphify-local.mjs");
  const base = { platform: "win32", host: "Bthwani", reportedHost: undefined, checkout: "D:\\samrim" };
  assert.doesNotThrow(() => assertRecoverySource(base));
  assert.doesNotThrow(() => assertRecoverySource({ ...base, reportedHost: "BTHWANI" }));
  for (const foreign of [
    { platform: "linux" },
    { host: "BTHWANI-DOCKER", reportedHost: "BTHWANI" },
    { reportedHost: "BTHWANI-DOCKER" },
    { checkout: "D:\\samrim-copy" },
    { checkout: "C:\\samrim" },
  ]) assert.throws(() => assertRecoverySource({ ...base, ...foreign }), /authorized Surface/);
});
