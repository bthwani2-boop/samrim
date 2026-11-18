import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowed, appendLogFile, assertCompatibleBranchTransition, branchTransitionPins, failureDetail, hash, isUnchanged, needsReconcile, parseRemoteHashes, persistAt, remoteConflict } from "./sync-lenovo-source.mjs";

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

test("source branch transitions remain automatic only with identical pinned dependencies", () => {
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
    assert.throws(
      () => assertCompatibleBranchTransition(before, changed, "codex/after"),
      /BRANCH_DEPENDENCIES_CHANGED_REQUIRES_INSTALL/,
      rel,
    );
  }
  assert.throws(() => assertCompatibleBranchTransition(before, current, ""), /SOURCE_SYNC_BRANCH_UNAUTHORIZED/);
  assert.throws(() => assertCompatibleBranchTransition(before, current, "archive/legacy"), /SOURCE_SYNC_BRANCH_UNAUTHORIZED/);
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
