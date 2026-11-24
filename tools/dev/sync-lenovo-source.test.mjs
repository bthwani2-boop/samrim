import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowed, appendLogFile, assertCompatibleBranchTransition, branchTransitionPins, buildManagedDeleteCode, buildPublishCode, failureDetail, hash, isUnchanged, needsReconcile, parseRemoteHashes, persistAt, remoteAuditDue, remoteConflict } from "./sync-lenovo-source.mjs";

test("manifest verification rejects an edit before HEAD changes and recovers after sync", {
  skip: process.platform !== "win32",
}, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-verify-mirror-"));
  const root = path.join(folder, "source");
  const localAppData = path.join(folder, "state");
  const manifestDir = path.join(localAppData, "BThwani", "Operations", "SourceSync");
  const entry = "tools/dev/sync-lenovo-source.mjs";
  const mirrored = [entry, "tools/dev/sync-lenovo-reconciliation.mjs", "apps/customer/example.ts", "apps/customer/package.json"];
  const git = (...args) => {
    const result = spawnSync("C:\\Program Files\\Git\\cmd\\git.exe", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    for (const rel of [...mirrored, "infra/owner-preview-source.mjs", "tools/security/verify-secrets.mjs"]) {
      const target = path.join(root, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      if (rel.endsWith("example.ts")) writeFileSync(target, "export const value = 1;\n");
      else if (rel.endsWith("package.json")) writeFileSync(target, JSON.stringify({name:"@fixture/customer",version:"1.0.0"}));
      else copyFileSync(new URL(`../../${rel}`, import.meta.url), target);
    }
    git("init", "-q");
    git("add", "apps/customer/example.ts");
    git("-c", "user.name=Mirror Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + folder, "commit", "-qm", "fixture");
    const head = git("rev-parse", "HEAD");
    mkdirSync(manifestDir, { recursive: true });
    const markSynced = () => writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify({
      version: 1,
      host: "BTHWANI-DOCKER",
      target: "C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime",
      head,
      branch: git("branch", "--show-current"),
      files: Object.fromEntries(mirrored.map(rel => [rel,
        createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex").toUpperCase()])),
    }));
    const verify = (flag="--verify-manifest") => {
      const result = spawnSync(process.execPath, [entry, flag], {
        cwd: root, env: { ...process.env, LOCALAPPDATA: localAppData }, encoding: "utf8", timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    markSynced();
    assert.equal(verify().current, true);
    writeFileSync(path.join(root, "apps/customer/example.ts"), "export const value = 2;\n");
    assert.deepEqual(verify(), { head, mirrorHead: head, current: false });
    const dependencyProof=verify("--verify-dependency-inputs");
    assert.equal(dependencyProof.current,true,"ordinary source edits do not block dependencies");
    assert.deepEqual(Object.keys(dependencyProof.files),["apps/customer/package.json"]);
    const pkg=path.join(root,"apps/customer/package.json");
    writeFileSync(pkg,JSON.stringify({name:"@fixture/customer",version:"1.0.1"}));
    assert.equal(verify("--verify-dependency-inputs").current,false,"unsynced dependency edit must block");
    markSynced();
    assert.equal(verify("--verify-dependency-inputs").current,true);
    markSynced();
    assert.equal(verify().current, true);
    writeFileSync(path.join(root, "apps/customer/added.ts"), "export const added = true;\n");
    assert.equal(verify().current, false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("manifest persistence replaces atomically and never deletes another pending file", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-source-manifest-"));
  try {
    const file = path.join(folder, "state", "manifest.json");
    persistAt(file, { version: 1 });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 1 });
    persistAt(file, { version: 2 });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 2 });

    const pending = `${file}.${process.pid}.tmp`;
    writeFileSync(pending, "pre-existing");
    assert.throws(() => persistAt(file, { version: 3 }), { code: "EEXIST" });
    assert.equal(readFileSync(pending, "utf8"), "pre-existing");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 2 });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("source digest reads a verified file descriptor and rejects non-files", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-source-digest-"));
  try {
    const file = path.join(folder, "safe.txt");
    writeFileSync(file, "verified", "utf8");
    assert.equal(hash(file), createHash("sha256").update("verified").digest("hex").toUpperCase());
    assert.throws(() => hash(path.join(folder, "missing.txt")), { code: "ENOENT" });
    assert.throws(() => hash(folder));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("source digest rejects symbolic links instead of following them", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-source-symlink-"));
  try {
    const file = path.join(folder, "safe.txt");
    const link = path.join(folder, "link.txt");
    writeFileSync(file, "verified", "utf8");
    try {
      symlinkSync(file, link, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("symlink creation not permitted on this Windows account");
        return;
      }
      throw error;
    }
    assert.throws(() => hash(link), (error) =>
      error.code === "ELOOP" || error.message.includes("UNSAFE_SOURCE_FILE"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("source-sync log writes through an open descriptor and rotates safely", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-source-sync-log-"));
  try {
    const log = path.join(folder, "logs", "sync.log");
    appendLogFile(log, "alpha", 4);
    assert.equal(readFileSync(log, "utf8"), "alpha\n");
    appendLogFile(log, "beta", 4);
    assert.equal(readFileSync(log + ".previous", "utf8"), "alpha\n");
    assert.equal(readFileSync(log, "utf8"), "beta\n");
    appendLogFile(log, "gamma", 4096);
    assert.equal(readFileSync(log, "utf8"), "beta\ngamma\n");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("failed backup rotation preserves the existing log", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-source-sync-backup-"));
  try {
    const log = path.join(folder, "sync.log");
    appendLogFile(log, "alpha", 4);
    mkdirSync(log + ".previous");
    assert.throws(() => appendLogFile(log, "beta", 4));
    assert.equal(readFileSync(log, "utf8"), "alpha\n");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("remote conflicts protect separately edited target files", () => {
  assert.equal(remoteConflict("OLDER", "NEW", "OLDER"), false);
  assert.equal(remoteConflict("NEW", "NEW", "OLDER"), false);
  assert.equal(remoteConflict("MISSING", "NEW", "OLDER"), false);
  assert.equal(remoteConflict("OTHER_WRITER", "NEW", "OLDER"), true);
  assert.equal(remoteConflict("OTHER_WRITER", "NEW", undefined), true);
});

test("process failure diagnostics preserve numeric exit codes and transient error messages", () => {
  assert.equal(failureDetail({ status: 255, stderr: "" }), "255");
  assert.equal(failureDetail({ status: 1, stderr: "not ready" }), "not ready");
  assert.equal(failureDetail({ status: null, error: { message: "ETIMEDOUT" } }), "ETIMEDOUT");
});

test("canonical source paths accepted without path injection", () => {
  for (const path of [
    "apps/customer/app/index.tsx",
    "apps/merchant/package.json",
    "apps/captain/mobile.config.json",
    "apps/control-panel/app/page.tsx",
    "packages/design-system/package.json",
    "services/identity/package.json",
    "services/identity/clients/index.ts",
    "services/dsh/clients/index.ts",
    "services/wlt/tsconfig.json",
    "tools/dev/Start-AppTunnel.ps1",
    "tools/dev/Start-RefoundationApp.ps1",
    "pnpm-lock.yaml", ".node-version"
  ]) assert.equal(allowed(path), true, path);
});
test("credentials, generated state, services and unowned paths rejected", () => {
  for (const path of [
    ".git/config", "infra/local/.env", "tools/dev/.env.tunnels.local", "apps/customer/.env",
    "apps/customer/.env.production", "apps/customer/google-services.json",
    "apps/customer/credentials.json", "apps/customer/keys.pem",
    "apps/customer/node_modules/expo/package.json",
    "apps/control-panel/.next/server.js", "apps/captain/dist/index.js",
    "services/wlt/backend/handler.go", "services/identity/database/migrations/001.sql",
    "services/dsh/contracts/openapi/dsh.openapi.yaml", "services/identity/clients/.env",
    "services/unowned/clients/index.ts", "docs/REFOUNDATION-PLAN.md",
    "D:/samrim/apps/customer/app/index.tsx",
    "../apps/customer/app/index.tsx", "apps/customer/../merchant/app/a.tsx",
    "apps/customer\\app\\index.tsx", "apps//customer/index.tsx",
    "apps/customer/id_ed25519", "tools/dev/temp.key",
    "apps/customer/.ssh/config", "apps/customer/.cache/file"
  ]) assert.equal(allowed(path), false, path);
});

test("idle polls avoid SSH and changes re-enable reconciliation", () => {
  const state = { head: "sha-a", files: { "apps/customer/index.tsx": "AAA", "package.json": "BBB" } };
  const matching = new Map(Object.entries(state.files));
  assert.equal(isUnchanged(state, matching, "sha-a"), true);
  assert.equal(isUnchanged(state, matching, "sha-b"), false);
  assert.equal(isUnchanged(state, new Map([["apps/customer/index.tsx", "CCC"], ["package.json", "BBB"]]), "sha-a"), false);
  assert.equal(isUnchanged(state, new Map([["package.json", "BBB"]]), "sha-a"), false);
  assert.equal(isUnchanged(null, matching, "sha-a"), false);
});

test("remote SHA batch parser requires all exact paths and authoritative digests", () => {
  const paths = ["apps/customer/app/index.tsx", "apps/merchant/app/index.tsx"];
  const a = "A".repeat(64);
  const valid = parseRemoteHashes(paths.map((p, i) => `${p}|${i ? "MISSING" : a}`).join("\n"), paths);
  assert.equal(valid.get(paths[0]), a);
  assert.equal(valid.get(paths[1]), "MISSING");
  assert.throws(() => parseRemoteHashes(`${paths[0]}|${a}`, paths), /REMOTE_HASH_RESPONSE_INCOMPLETE/);
  assert.throws(() => parseRemoteHashes(`${paths[0]}|B\n${paths[1]}|${a}`, paths), /REMOTE_HASH_RESPONSE_INVALID/);
  assert.throws(() => parseRemoteHashes(`${paths[0]}|${a}\n${paths[0]}|${a}`, paths), /REMOTE_HASH_RESPONSE_INVALID/);
  assert.throws(() => parseRemoteHashes(`../../unsafe|${a}\n${paths[1]}|${a}`, paths), /REMOTE_HASH_RESPONSE_INVALID/);
});

test("an unchanged manifest still requires recovery if Lenovo drifted", () => {
  const rel = "apps/captain/app/index.tsx";
  const current = new Map([[rel, "A".repeat(64)]]);
  const state = { head: "sha-a", files: Object.fromEntries(current) };
  assert.equal(needsReconcile(state, current, "sha-a", new Map(current)), false);
  assert.equal(needsReconcile(state, current, "sha-a", new Map([[rel, "B".repeat(64)]])), true);
  assert.equal(needsReconcile(state, current, "sha-a", new Map([[rel, "MISSING"]])), true);
  assert.equal(needsReconcile(state, current, "sha-b", new Map(current)), true);
});

test("incremental remote audits check inspected paths, not uninspected files", () => {
  const a = "apps/customer/app/index.tsx";
  const b = "apps/captain/app/index.tsx";
  const current = new Map([[a, "A".repeat(64)], [b, "B".repeat(64)]]);
  const state = { head: "sha-x", files: Object.fromEntries(current) };
  assert.equal(needsReconcile(state, current, "sha-x", new Map([[a, "A".repeat(64)]])), false);
  assert.equal(needsReconcile(state, current, "sha-x", new Map([[a, "C".repeat(64)]])), true);
  assert.equal(needsReconcile(state, current, "sha-x", new Map([[a, "MISSING"]])), true);
  assert.equal(needsReconcile(state, current, "sha-x", new Map([["tools/dev/old.txt", "MISSING"]])), false);
  assert.equal(needsReconcile(state, current, "sha-x", new Map([["tools/dev/old.txt", "C".repeat(64)]])), true);
});

test("source branch transitions do not block mirroring when dependencies change", () => {
  assert.deepEqual(branchTransitionPins, [
    ".node-version", "pnpm-lock.yaml", "package.json",
    "apps/customer/package.json", "apps/merchant/package.json",
    "apps/captain/package.json", "apps/control-panel/package.json",
    "services/identity/package.json", "services/dsh/package.json", "services/wlt/package.json",
  ]);
  const current = new Map(branchTransitionPins.map((rel, i) => [
    rel, String(i % 10).repeat(64),
  ]));
  current.set("apps/customer/app/health.tsx", "B".repeat(64));
  const before = { branch: "codex/before", head: "sha-1", files: Object.fromEntries(current) };
  assert.equal(assertCompatibleBranchTransition(before, current, "codex/after"), true);
  assert.equal(assertCompatibleBranchTransition(before, current, "codex/before"), false);
  assert.equal(assertCompatibleBranchTransition(null, current, "codex/after"), false);
  for (const rel of branchTransitionPins) {
    const changed = new Map(current);
    changed.set(rel, "A".repeat(64));
    assert.equal(assertCompatibleBranchTransition(before, changed, "codex/after"), true, rel);
  }
  assert.throws(() => assertCompatibleBranchTransition(before, current, ""), /SOURCE_SYNC_BRANCH_UNAUTHORIZED/);
  assert.throws(() => assertCompatibleBranchTransition(before, current, "archive/legacy"), /SOURCE_SYNC_BRANCH_UNAUTHORIZED/);
});

test("mirroring source does not depend on installed node_modules or an internal pnpm lock", () => {
  const source = readFileSync(new URL("./sync-lenovo-source.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /TARGET_DEPENDENCIES_MISSING|DEPENDENCIES_CHANGED_REQUIRES_INSTALL/);
  assert.match(source, /DEPENDENCY_INSTALL_REQUIRED/);
  assert.equal(allowed("apps/customer/node_modules/metro/index.js"), false);
});

test("compatible new branch at the same HEAD still must reconcile manifest branch", () => {
  const state = {
    branch: "codex/before",
    head: "sha-1",
    files: { "apps/customer/app/health.tsx": "A".repeat(64) },
  };
  const files = new Map(Object.entries(state.files));
  assert.equal(needsReconcile(state, files, "sha-1", new Map(files), "codex/before"), false);
  assert.equal(needsReconcile(state, files, "sha-1", new Map(files), "codex/after"), true);
});


function isolatedPowerShell(code) {
  // Run only command builders against disposable local files. Never invoke SSH,
  // the Lenovo watcher, or source reconciliation during this regression.
  return spawnSync("pwsh.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(code, "utf16le").toString("base64"),
  ], { encoding: "utf8", windowsHide: true, timeout: 15000 });
}

test("replacement archives bytes written after the initial digest check", { skip: process.platform !== "win32" }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-atomic-replace-"));
  try {
    const dest = path.join(folder, "destination.txt");
    const stage = path.join(folder, "staged.txt");
    const backup = path.join(folder, "original.bak");
    const archive = path.join(folder, "conflicts", "displaced.txt");
    writeFileSync(dest, "observed");
    writeFileSync(stage, "replacement");
    const code = buildPublishCode({
      dest, stage, backup, archive,
      actual: createHash("sha256").update("observed").digest("hex").toUpperCase(),
      expected: createHash("sha256").update("replacement").digest("hex").toUpperCase(),
      conflict: false,
      root: folder,
    });
    const replacement = "[IO.File]::Replace($stage,$dest,$backup);";
    assert.ok(code.includes(replacement), "expected atomic File.Replace");
    const withConcurrentWrite = code.replace(replacement,
      "[IO.File]::WriteAllText($dest,'unexpected-edit');" + replacement);
    const result = isolatedPowerShell(withConcurrentWrite);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PUBLISHED/);
    assert.equal(readFileSync(dest, "utf8"), "replacement");
    assert.equal(existsSync(backup), false);
    const archives = readdirSync(path.dirname(archive));
    const kept = archives.filter(name => name.startsWith("displaced.txt.replaced-"));
    assert.equal(kept.length, 1, "must retain the actual displaced version");
    assert.equal(readFileSync(path.join(path.dirname(archive), kept[0]), "utf8"), "unexpected-edit");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("managed deletion archives a concurrent edit before removing its quarantine", { skip: process.platform !== "win32" }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-atomic-delete-"));
  try {
    const dest = path.join(folder, "managed.txt");
    const quarantine = dest + ".quarantine";
    const archive = path.join(folder, "conflicts", "managed.txt");
    writeFileSync(dest, "observed");
    const code = buildManagedDeleteCode({
      dest, quarantine, archive,
      actual: createHash("sha256").update("observed").digest("hex").toUpperCase(),
      conflict: false,
    });
    assert.ok(code.includes("[IO.File]::Move($p,$quarantine)"));
    const changed = code.replace("[IO.File]::Move($p,$quarantine)",
      "[IO.File]::WriteAllText($p,'unexpected-edit');[IO.File]::Move($p,$quarantine)");
    const result = isolatedPowerShell(changed);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /DELETED_PRESERVED/);
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(quarantine), false);
    assert.equal(readFileSync(archive, "utf8"), "unexpected-edit");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("failed archive restores a quarantined file without losing bytes", { skip: process.platform !== "win32" }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-delete-restore-"));
  try {
    const dest = path.join(folder, "managed.txt");
    const quarantine = dest + ".quarantine";
    const notDirectory = path.join(folder, "not-a-directory");
    writeFileSync(dest, "observed");
    writeFileSync(notDirectory, "existing");
    const code = buildManagedDeleteCode({
      dest, quarantine, archive: path.join(notDirectory, "unwritable.txt"),
      actual: createHash("sha256").update("observed").digest("hex").toUpperCase(),
      conflict: true,
    });
    const result = isolatedPowerShell(code);
    assert.notEqual(result.status, 0, "a failed archive must fail closed");
    assert.equal(readFileSync(dest, "utf8"), "observed");
    assert.equal(existsSync(quarantine), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a replacement created during deletion is never overwritten or removed", { skip: process.platform !== "win32" }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-delete-replacement-"));
  try {
    const dest = path.join(folder, "managed.txt");
    const quarantine = dest + ".quarantine";
    writeFileSync(dest, "observed");
    const code = buildManagedDeleteCode({
      dest, quarantine, archive: path.join(folder, "conflicts", "managed.txt"),
      actual: createHash("sha256").update("observed").digest("hex").toUpperCase(),
      conflict: false,
    });
    const updated = code.replace("[IO.File]::Move($p,$quarantine)",
      "[IO.File]::Move($p,$quarantine);[IO.File]::WriteAllText($p,'replacement-edit')");
    const result = isolatedPowerShell(updated);
    assert.notEqual(result.status, 0, "a concurrent replacement must fail closed");
    assert.equal(readFileSync(dest, "utf8"), "replacement-edit");
    assert.equal(readFileSync(quarantine, "utf8"), "observed");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});


test("full remote audit deadline is not postponed by continuing source edits", () => {
  const state = { branch: "codex/managed-participant-admission", files: {} };
  assert.equal(remoteAuditDue(null, 999999, 1), true);
  assert.equal(remoteAuditDue(state, 30000, 29999), false);
  assert.equal(remoteAuditDue(state, 30000, 30000), true);
  assert.equal(remoteAuditDue(state, 30000, 30500), true);
});

test("managed deletion refuses an ancestor junction outside the source mirror", { skip: process.platform !== "win32" }, (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "bthwani-delete-junction-"));
  try {
    const root = path.join(folder, "mirror");
    const external = path.join(folder, "external");
    mkdirSync(root);
    mkdirSync(external);
    const junction = path.join(root, "app");
    try {
      symlinkSync(external, junction, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("junction creation unavailable on this test host");
        return;
      }
      throw error;
    }
    writeFileSync(path.join(external, "protected.txt"), "protected");
    const dest = path.join(junction, "protected.txt");
    const quarantine = dest + ".quarantine";
    const code = buildManagedDeleteCode({
      dest, root, quarantine, archive: path.join(folder, "conflicts", "protected.txt"),
      actual: createHash("sha256").update("protected").digest("hex").toUpperCase(),
      conflict: false,
    });
    const result = isolatedPowerShell(code);
    assert.notEqual(result.status, 0, "ancestor junction must block managed removal");
    assert.equal(readFileSync(path.join(external, "protected.txt"), "utf8"), "protected");
    assert.equal(existsSync(quarantine), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// The existing watcher owns a single bounded runtime attempt and does not retry ambiguous writes.
test("runtime reconciliation trigger is immediate for changed committed source and respects retry gates", async () => {
  const { runtimePollDue } = await import("./sync-lenovo-reconciliation.mjs");
  const base={enabled:true,dirty:false,active:false,key:"new",last:{key:"old",status:"pass"},now:100,nextAudit:200};
  assert.equal(runtimePollDue(base),true);
  for(const override of [{enabled:false},{dirty:true},{active:true},{last:{key:"old",status:"running"}},{last:{key:"old",status:"uncertain"}},{last:{key:"new",status:"blocked"}},{last:{key:"new",status:"retry"}}]) assert.equal(runtimePollDue({...base,...override}),false);
  assert.equal(runtimePollDue({...base,last:{key:"new",status:"retry"},now:201}),true);
  assert.equal(runtimePollDue({...base,last:{key:"old",status:"blocked"}}),true);
});

test("a reconciler can durably acknowledge only its own verified attempt after watcher loss", async()=>{
  const { acknowledgeRuntimeAttempt, runtimeReceiptStatus } = await import("./sync-lenovo-reconciliation.mjs");
  const folder=mkdtempSync(path.join(tmpdir(),"bthwani-runtime-receipt-"));
  const file=path.join(folder,"runtime-reconcile.json");
  const receipt=path.join(folder,"runtime-reconcile.receipt.json");
  const key="a".repeat(64), attempt="11111111-1111-4111-8111-111111111111";
  const next="22222222-2222-4222-8222-222222222222";
  const running={version:1,key,attempt,status:"running"};
  try {
    writeFileSync(file,JSON.stringify(running));
    assert.equal(runtimeReceiptStatus(file,receipt),null);
    assert.throws(()=>acknowledgeRuntimeAttempt(file,receipt,key,next),/RUNTIME_ATTEMPT_MISMATCH/);
    assert.equal(existsSync(receipt),false);
    acknowledgeRuntimeAttempt(file,receipt,key,attempt);
    assert.deepEqual(JSON.parse(readFileSync(file,"utf8")),running);
    assert.equal(runtimeReceiptStatus(file,receipt),"pass");
    writeFileSync(file,JSON.stringify({...running,status:"uncertain"}));
    assert.equal(runtimeReceiptStatus(file,receipt),"pass");
    writeFileSync(file,JSON.stringify({...running,attempt:next}));
    assert.equal(runtimeReceiptStatus(file,receipt),null);
    assert.throws(()=>acknowledgeRuntimeAttempt(file,receipt,key,attempt),/RUNTIME_ATTEMPT_MISMATCH/);
    assert.equal(runtimeReceiptStatus(file,receipt),null);
    writeFileSync(receipt,"{broken");
    assert.equal(runtimeReceiptStatus(file,receipt),null);
  } finally { rmSync(folder,{recursive:true,force:true}); }
});

test("explicit recovery receipt releases only the exact previously reviewed hold, never a changed attempt",async()=>{
  const { acknowledgeRuntimeRecovery, runtimeReceiptStatus }=await import("./sync-lenovo-reconciliation.mjs");
  const folder=mkdtempSync(path.join(tmpdir(),"bthwani-runtime-recovery-"));
  const state=path.join(folder,"runtime-reconcile.json"), receipt=path.join(folder,"runtime-reconcile.receipt.json");
  const key="b".repeat(64), original=JSON.stringify({version:1,key,status:"running"});
  try {
    writeFileSync(state,original);
    assert.throws(()=>acknowledgeRuntimeRecovery(state,receipt,"c".repeat(64),original),/RUNTIME_ATTEMPT_MISMATCH/);
    assert.equal(existsSync(receipt),false);
    acknowledgeRuntimeRecovery(state,receipt,key,original);
    assert.equal(runtimeReceiptStatus(state,receipt),"retry");
    assert.equal(readFileSync(state,"utf8"),original);
    const changed=JSON.stringify({version:1,key,status:"uncertain"});
    writeFileSync(state,changed);
    assert.equal(runtimeReceiptStatus(state,receipt),null);
    assert.throws(()=>acknowledgeRuntimeRecovery(state,receipt,key,original),/RUNTIME_ATTEMPT_MISMATCH/);
    writeFileSync(state,JSON.stringify({version:1,key,status:"blocked"}));
    assert.throws(()=>acknowledgeRuntimeRecovery(state,receipt,key,readFileSync(state,"utf8")),/RUNTIME_ATTEMPT_MISMATCH/);
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test("runtime attempt outcome distinguishes known readback from ambiguous writes",async()=>{
  const {runtimeAttemptResult}=await import("./sync-lenovo-reconciliation.mjs");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\nOWNER_APPLY_VERIFIED dsh\n","Source changed"),"retry");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\n",""),"uncertain");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\n","ROLLBACK_PASS dsh"),"blocked");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\n","ROLLBACK_BLOCKED"),"uncertain");
  assert.equal(runtimeAttemptResult(1,"SIGTERM","",""),"uncertain");
});

test("Graphify scheduling responds to saved code and ignores its own generated output",async()=>{
  const {graphifySourceEvent}=await import("./sync-lenovo-reconciliation.mjs");
  for(const rel of ["services\\dsh\\backend\\cmd\\dsh\\main.go","apps/customer/src/new.tsx","AGENTS.md","docs/reference/a.md",".agents/skills/speckit-plan/SKILL.md",".git/HEAD",".git/refs/heads/codex/test"])assert.equal(graphifySourceEvent(rel),true,rel);
  for(const rel of ["graphify-out/graph.json","apps/customer/node_modules/pkg/index.js","apps/customer/.expo/a.json","infra/.env.local",".git/index",".git/objects/aa/bb","apps/customer/coverage/data.json"])assert.equal(graphifySourceEvent(rel),false,rel);
  assert.equal(graphifySourceEvent(null),true);
});
test("Graphify debounce, bounded audit and single active attempt",async()=>{
  const {graphifyPollDue}=await import("./sync-lenovo-reconciliation.mjs");
  const base={now:10000,dirtySince:8000,lastEvent:9500,nextAudit:30000,busy:false};
  assert.equal(graphifyPollDue(base),false);
  assert.equal(graphifyPollDue({...base,now:12500}),true);
  assert.equal(graphifyPollDue({...base,now:23000,lastEvent:22999}),true);
  assert.equal(graphifyPollDue({...base,now:30000,dirtySince:null}),true);
  assert.equal(graphifyPollDue({...base,now:30000,busy:true}),false);
  assert.equal(graphifyPollDue({...base,dirtySince:null}),false);
});
test("watcher reload waits for committed code and drains existing children",async()=>{
  const {watcherReloadAction}=await import("./sync-lenovo-reconciliation.mjs");
  const base={loaded:"old",current:"new",dirty:false,busy:false};
  assert.equal(watcherReloadAction({...base,current:"old"}),"current");
  assert.equal(watcherReloadAction({...base,dirty:true}),"defer");
  assert.equal(watcherReloadAction({...base,busy:true}),"drain");
  assert.equal(watcherReloadAction(base),"reload");
});

test("a drained watcher reload replaces its thread inside the same process", { timeout: 10000 }, async (t) => {
  const { watchInProcess } = await import("./sync-lenovo-source.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "bthwani-watch-reload-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, "watch.mjs");
  const revision = path.join(dir, "revision.mjs");
  const evidence = path.join(dir, "evidence.jsonl");
  writeFileSync(revision, 'export const revision = "old";');
  writeFileSync(entry, [
    'import { appendFileSync, writeFileSync } from "node:fs";',
    'import { threadId } from "node:worker_threads";',
    'import { revision } from "./revision.mjs";',
    'appendFileSync(new URL("./evidence.jsonl", import.meta.url), JSON.stringify({pid:process.pid, threadId, revision, args:process.argv.slice(2)}) + "\\n");',
    'if (revision === "old") {',
    '  writeFileSync(new URL("./revision.mjs", import.meta.url), \'export const revision = "new";\');',
    '  process.exitCode = 75;',
    '}',
  ].join("\n"));
  assert.equal(typeof watchInProcess, "function");
  assert.equal(await watchInProcess(entry), 0);
  const rows = readFileSync(evidence, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map(r => r.revision), ["old", "new"]);
  assert.ok(rows.every(r => r.pid === process.pid && r.threadId > 0));
  assert.notEqual(rows[0].threadId, rows[1].threadId);
  assert.deepEqual(rows.map(r => r.args), [["--watch"], ["--watch"]]);
});

test("a watcher failure is not mistaken for a reload request", { timeout: 10000 }, async (t) => {
  const { watchInProcess } = await import("./sync-lenovo-source.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "bthwani-watch-failure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, "watch.mjs");
  writeFileSync(entry, 'process.exitCode = 1;');
  assert.equal(await watchInProcess(entry), 1);
  writeFileSync(entry, 'throw new Error("fixture worker failed");');
  await assert.rejects(watchInProcess(entry), /fixture worker failed/);
});

test("Graphify automation refreshes stale trusted graphs but never adopts unknown provenance",async()=>{
  const {graphifyRefreshAction}=await import("./sync-lenovo-reconciliation.mjs");
  assert.equal(graphifyRefreshAction({status:"PASS",queryable:true}),"current");
  assert.equal(graphifyRefreshAction({status:"INVALIDATED",queryable:true}),"refresh");
  assert.equal(graphifyRefreshAction({status:"INVALIDATED",queryable:true,dirty:true,unsafeUntracked:0}),"refresh");
  assert.equal(graphifyRefreshAction({status:"INVALIDATED",queryable:true,unsafeUntracked:1}),"deferred");
  assert.equal(graphifyRefreshAction({status:"INVALIDATED",queryable:true,refreshing:true}),"busy");
  assert.equal(graphifyRefreshAction({status:"BLOCKED",queryable:false,reason:"indexed branch differs"}),"refresh");
  for(const reason of ["indexed repository differs","unverified local Graphify index","index locked"])assert.equal(graphifyRefreshAction({status:"BLOCKED",queryable:false,reason}),"blocked");
  assert.equal(graphifyRefreshAction(null),"blocked");
});

test("native Graphify refreshes changed tracked source before Commit",{
  skip:process.env.BTHWANI_GRAPHIFY_INTEGRATION!=="1",timeout:240000,
},t=>{
  const dir=mkdtempSync(path.join(tmpdir(),"bthwani-graphify-preview-test-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const script="tools/dev/graphify-local.mjs";
  const exe=process.platform==="win32"?"git.exe":"git";
  const call=(program,args)=>{
    const result=spawnSync(program,args,{cwd:dir,encoding:"utf8",windowsHide:true,timeout:180000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    return result.stdout;
  };
  const git=(...args)=>call(exe,args);
  const cli=(action)=>call(process.execPath,[script,action]);
  mkdirSync(path.join(dir,"tools","dev"),{recursive:true});
  mkdirSync(path.join(dir,"graphify-out"));
  mkdirSync(path.join(dir,"empty-hooks"));
  writeFileSync(path.join(dir,script),readFileSync(new URL("./graphify-local.mjs",import.meta.url)));
  mkdirSync(path.join(dir,"tools","security"),{recursive:true});
  writeFileSync(path.join(dir,"tools","security","verify-secrets.mjs"),readFileSync(new URL("../security/verify-secrets.mjs",import.meta.url)));
  writeFileSync(path.join(dir,".gitignore"),"graphify-out/\nempty-hooks/\n");
  const source=path.join(dir,"example.ts");
  writeFileSync(source,"export function originalFixture() { return 1; }\n");
  writeFileSync(path.join(dir,"other.ts"),"export function stableFixture() { return 2; }\n");
  git("init","-q","-b","fixture");
  git("config","core.hooksPath",path.join(dir,"empty-hooks"));
  git("config","user.name","Graphify fixture");
  git("config","user.email","graphify-fixture@example.invalid");
  git("config","commit.gpgsign","false");
  git("add",".");git("commit","-qm","fixture");
  const initial=Date.now();cli("refresh");const firstMs=Date.now()-initial;
  const head=git("rev-parse","HEAD").trim();
  writeFileSync(source,"export function originalFixture() { return 3; }\nexport function addedBeforeCommitFixture() { return originalFixture(); }\n");
  assert.equal(JSON.parse(cli("status")).status,"INVALIDATED");
  const started=Date.now();const output=cli("refresh");const updateMs=Date.now()-started;
  const state=JSON.parse(cli("status"));
  assert.equal(state.status,"PASS");assert.equal(state.dirty,true);
  assert.equal(state.indexedHead,head);assert.equal(git("rev-parse","HEAD").trim(),head);
  const graph=JSON.parse(readFileSync(path.join(dir,"graphify-out","graph.json"),"utf8"));
  assert.ok(graph.nodes.some(n=>String(n.label).includes("addedBeforeCommitFixture")));
  assert.ok(graph.nodes.some(n=>String(n.label).includes("stableFixture")));
  t.diagnostic("native initialMs="+firstMs+" changedSourceMs="+updateMs);
  const cacheLines=output.split(/\r?\n/).filter(line=>/uncached|cached/i.test(line)).slice(0,3);
  if(cacheLines.length)t.diagnostic(cacheLines.join(" | "));
});

test("native recursive file event reaches Graphify scheduling without a Git commit",{timeout:10000},async t=>{
  const {watch}=await import("node:fs");
  const {graphifySourceEvent,graphifyPollDue}=await import("./sync-lenovo-reconciliation.mjs");
  const dir=mkdtempSync(path.join(tmpdir(),"bthwani-graphify-event-"));
  const app=path.join(dir,"apps","customer","src");
  mkdirSync(app,{recursive:true});
  const source=path.join(app,"example.ts");
  writeFileSync(source,"export const example=1;\n");
  let watcher;
  try{
    const observed=new Promise((resolve,reject)=>{
      watcher=watch(dir,{recursive:true},(_event,name)=>{
        if(name && graphifySourceEvent(name) && String(name).endsWith("example.ts"))resolve(String(name));
      });
      watcher.once("error",reject);
    });
    t.after(()=>watcher?.close());
    const timer=setTimeout(()=>writeFileSync(source,"export const example=2;\n"),50);
    let deadline;
    try{
      const name=await Promise.race([observed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error("source event not delivered")),4000);})]);
      assert.equal(name.replaceAll("\\","/"),"apps/customer/src/example.ts");
      assert.equal(graphifyPollDue({now:3000,dirtySince:0,lastEvent:0,nextAudit:30000,busy:false}),true);
    }finally{clearTimeout(timer);clearTimeout(deadline);}
  }finally{watcher?.close();rmSync(dir,{recursive:true,force:true});}
});

test("reconciliation requires an explicit terminal result and never certifies a partial result",async()=>{
  const {runtimeAttemptResult}=await import("./sync-lenovo-reconciliation.mjs");
  const sha="a".repeat(40);
  assert.equal(runtimeAttemptResult(0,null,"",""),"retry");
  assert.equal(runtimeAttemptResult(0,null,"RECONCILE_PASS HEAD="+sha+"\n",""),"pass");
  assert.equal(runtimeAttemptResult(1,null,"RECONCILE_PARTIAL HEAD="+sha+"\n",""),"review");
  assert.equal(runtimeAttemptResult(3,null,"RECONCILE_PARTIAL HEAD="+sha+"\n","BASELINE_PROOF_FAIL rehearsal unavailable"),"retry");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\n","ROLLBACK_BLOCKED owner schema or runtime transition requires durable readback"),"uncertain");
  assert.equal(runtimeAttemptResult(0,null,"OWNER_APPLY_STARTED dsh\nRECONCILE_PASS HEAD="+sha+"\n",""),"uncertain");
  assert.equal(runtimeAttemptResult(1,null,"OWNER_APPLY_STARTED dsh\nRECONCILE_PARTIAL HEAD="+sha+"\n",""),"uncertain");
});

test("fresh baseline rehearsal is scheduled on a new runtime key, not every review audit", async()=>{
  const {runtimeBaselineProofDue}=await import("./sync-lenovo-reconciliation.mjs");
  assert.equal(runtimeBaselineProofDue("new",null),true);
  assert.equal(runtimeBaselineProofDue("new",{key:"old",status:"review"}),true);
  assert.equal(runtimeBaselineProofDue("new",{key:"new",status:"review"}),false);
  assert.equal(runtimeBaselineProofDue("new",{key:"new",status:"retry"}),true);
  assert.equal(runtimeBaselineProofDue("new",{key:"new",status:"uncertain"}),false);
});

test("dependency changes include workspace manifests, patches and removed inputs without reporting ordinary source edits",async()=>{
  const {dependencyInputChanges}=await import("./sync-lenovo-reconciliation.mjs");
  const before={files:{"pnpm-workspace.yaml":"a","packages/design-system/package.json":"a","patches/example.patch":"a","apps/customer/app/index.tsx":"a"}};
  const current=new Map([["pnpm-workspace.yaml","b"],["packages/design-system/package.json","b"],["patches/other.patch","a"],["apps/customer/app/index.tsx","b"]]);
  assert.deepEqual(dependencyInputChanges(before,current),["packages/design-system/package.json","patches/example.patch","patches/other.patch","pnpm-workspace.yaml"]);
  assert.deepEqual(dependencyInputChanges({files:Object.fromEntries(current)},current),[]);
});
