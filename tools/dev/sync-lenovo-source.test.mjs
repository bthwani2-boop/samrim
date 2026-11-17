import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowed, appendLogFile, failureDetail, hash, isUnchanged, persistAt, remoteConflict } from "./sync-lenovo-source.mjs";

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
