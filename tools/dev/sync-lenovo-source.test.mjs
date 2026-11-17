import assert from "node:assert/strict";
import test from "node:test";
import { allowed, failureDetail, isUnchanged, remoteConflict } from "./sync-lenovo-source.mjs";

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
    "services/wlt/backend/handler.go", "docs/REFOUNDATION-PLAN.md",
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
