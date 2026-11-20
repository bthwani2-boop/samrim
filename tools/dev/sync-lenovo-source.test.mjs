import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowed, appendLogFile, assertCompatibleBranchTransition, branchTransitionPins, buildManagedDeleteCode, buildPublishCode, failureDetail, hash, isUnchanged, needsReconcile, parseRemoteHashes, persistAt, remoteAuditDue, remoteConflict } from "./sync-lenovo-source.mjs";

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
    "tools/dev/Start-LenovoSourceSync.ps1",
    "infra/Start-RefoundationApp.ps1",
    "pnpm-lock.yaml", ".node-version"
  ]) assert.equal(allowed(path), true, path);
});
test("credentials, generated state, services and unowned paths rejected", () => {
  for (const path of [
    ".git/config", "infra/local/.env", "apps/customer/.env",
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
