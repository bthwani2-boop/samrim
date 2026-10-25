import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const script = readFileSync(resolve(root, "tools/mobile/build-development.ps1"), "utf8");
const sourceApps = ["app-client", "app-partner", "app-captain", "app-field"];

test("offline plan must exit before all secret reads, cloud calls and build submission", () => {
  const start = script.indexOf("if ($OfflinePlan) {");
  const secretRead = script.indexOf("$RequiredInputs = @($CredentialVaultPath, $KeystoreVaultPath)");
  const cloud = script.indexOf('$null = Invoke-EasText @("whoami", "--non-interactive")');
  assert.ok(start > 0 && start < secretRead && secretRead < cloud);
  const body = script.slice(start, secretRead);
  assert.match(body, /\$Submit -or \$Wait/);
  assert.match(body, /EAS_OFFLINE_PLAN=READY/);
  assert.match(body, /EAS_BUILDS_SUBMITTED=0 EAS_SECRETS_MATERIALIZED=0/);
  assert.match(body, /platform=android profile=development output=apk/);
  assert.match(body, /platform=ios profile=ios-simulator output=simulator/);
  assert.match(body, /\n\s*return\s*\n/);
  assert.doesNotMatch(body, /Copy-Item|Invoke-EasJson|Invoke-EasText|Start-ThreadJob|New-EasCredentialMaterialization/);
});

for (const app of sourceApps) {
  test(app + " exposes a pinned, committed local development APK profile", () => {
    const eas = JSON.parse(readFileSync(resolve(root, "apps", app, "eas.json"), "utf8"));
    assert.equal(eas.cli.requireCommit, true);
    assert.equal(eas.build.development.extends, "base");
    assert.equal(eas.build.development.developmentClient, true);
    assert.equal(eas.build.development.channel, "development");
    assert.equal(eas.build.development.android.buildType, "apk");
    assert.match(eas.build.base.node, /^\d+\.\d+\.\d+$/);
    assert.match(eas.build.base.pnpm, /^\d+\.\d+\.\d+$/);
    const sim = eas.build["ios-simulator"];
    assert.equal(sim.extends, "development");
    assert.equal(sim.ios.simulator, true);
    assert.equal(sim.developmentClient, undefined); // Inherited from development.
  });
}

test("every application is eligible for parallel Android and iOS submissions", () => {
  assert.match(script, /\$IosEnabled = \$App -in @\("app-client", "app-partner", "app-captain", "app-field"\)/);
  for (const app of sourceApps) {
    const eas = JSON.parse(readFileSync(resolve(root, "apps", app, "eas.json"), "utf8"));
    assert.equal(eas.build["ios-simulator"].extends, "development", app);
    assert.equal(eas.build["ios-simulator"].ios.simulator, true, app);
    assert.equal(eas.build.development.developmentClient, true, app);
  }
});

test("explicit Submit retains parallel Android and iOS submission logic", () => {
  assert.match(script, /\$BuildRequests \+= \[pscustomobject\]@\{ Platform = "android"; Profile = "development" \}/);
  assert.match(script, /\$BuildRequests \+= \[pscustomobject\]@\{ Platform = "ios"; Profile = "ios-simulator" \}/);
  assert.match(script, /Start-ThreadJob/);
  assert.match(script, /\$Jobs \| Wait-Job/);
  assert.ok(script.indexOf("Start-ThreadJob") < script.indexOf("$Jobs | Wait-Job"));
});


test("EAS CLI temporary peer compatibility is scoped only to pnpm dlx", () => {
  const inline = script.match(/pnpm --config\.strict-peer-dependencies=false dlx/g) ?? [];
  assert.equal(inline.length, 2, "text and JSON EAS CLI wrappers");
  assert.match(script, /"\-\-config\.strict-peer-dependencies=false", "dlx"/);
  const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /^strictPeerDependencies: true$/m);
  assert.match(workspace, /^autoInstallPeers: false$/m);
});
