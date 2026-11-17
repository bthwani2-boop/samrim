import assert from "node:assert/strict";
import test from "node:test";
import { allowed } from "./sync-lenovo-source.mjs";

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
