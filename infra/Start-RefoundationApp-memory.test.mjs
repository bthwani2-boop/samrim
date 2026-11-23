import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("./Start-RefoundationApp.ps1", import.meta.url));
const launcher = readFileSync(file, "utf8");

test("the Lenovo Metro memory ceiling is scoped to Customer and Merchant Web only", () => {
  assert.match(launcher, /\$env:NODE_OPTIONS='--dns-result-order=ipv4first'/);
  assert.match(launcher, /if \(!\$Surface -and \$App -in @\('customer','merchant'\)\)/);
  assert.match(launcher, /hostname\)\.ToUpperInvariant\(\) -ne 'BTHWANI-DOCKER'/);
  assert.match(launcher, /TotalVisibleMemorySize -lt \(24 \* 1MB\)/);
  assert.match(launcher, /\$env:NODE_OPTIONS \+= ' --max-old-space-size=6144'/);
  assert.doesNotMatch(launcher, /EXPO_PUBLIC_NODE_OPTIONS/);
});

test("the pinned Node runtime admits the verified 6 GiB V8 ceiling", () => {
  const run = spawnSync(process.execPath, [
    "-e", "console.log(require('node:v8').getHeapStatistics().heap_size_limit)",
  ], {
    env: {...process.env, NODE_OPTIONS:"--dns-result-order=ipv4first --max-old-space-size=6144"},
    encoding:"utf8", timeout:12000, windowsHide:true,
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const heap = Number(run.stdout.trim());
  assert.ok(Number.isSafeInteger(heap) && heap > 5 * 1024 ** 3 && heap < 7 * 1024 ** 3);
});

test("the PowerShell launcher remains parseable without starting a shared app", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell syntax checked on Surface");
  const source = file.replaceAll("'", "''");
  const command = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${source}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object Message;exit 1}`;
  const result = spawnSync("pwsh", ["-NoProfile","-Command",command], {
    encoding:"utf8", timeout:12000, windowsHide:true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});

test("Lenovo Android Customer Identity rejects a different app or Surface preview before startup", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell launcher checked on Surface");
  for (const selection of [["-App", "merchant"], ["-App", "customer", "-Surface"]]) {
    const result = spawnSync("pwsh", [
      "-NoProfile", "-File", file, ...selection, "-EnableDockerCustomerAndroidIdentityPreview",
    ], { encoding: "utf8", timeout: 12000, windowsHide: true });
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /DOCKER_ANDROID_IDENTITY_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY/);
  }
});

test("Lenovo Android Customer manifest advertises the tunnel instead of the server's listen port", () => {
  const preview = launcher.split("if ($EnableDockerCustomerAndroidIdentityPreview) {")[1];
  assert.ok(preview);
  assert.match(preview, /\$env:EXPO_PACKAGER_PROXY_URL='http:\/\/127\.0\.0\.1:18101'/);
});

test("Lenovo Merchant and Captain Native sign-in requires isolated Identity and DSH owners", () => {
  assert.match(launcher, /if \(\$App -in @\('merchant','captain'\)\)/);
  assert.match(launcher, /DOCKER_ROLE_ANDROID_IDENTITY_REQUIRES_VERIFIED_LENOVO/);
  assert.match(launcher, /DOCKER_ROLE_ANDROID_OWNERS_NOT_ISOLATED/);
  assert.match(launcher, /IDENTITY_SYNTHETIC_PHONE_AUTH=true/);
  assert.match(launcher, /IDENTITY_DB_SCHEMA=identity_test_/);
  assert.match(launcher, /DSH_DB_SCHEMA=dsh_test_/);
  assert.match(launcher, /EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN='http:\/\/127\.0\.0\.1:3201'/);
  assert.match(launcher, /EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN='http:\/\/127\.0\.0\.1:3202'/);
  assert.match(launcher, /EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN='http:\/\/127\.0\.0\.1:3201'/);
  assert.match(launcher, /EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN='http:\/\/127\.0\.0\.1:3202'/);
});

test("Lenovo-only role admission rejects an unauthorized Surface launch before startup", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell launcher checked on Surface");
  for (const role of ["merchant", "captain"]) {
    const result = spawnSync("pwsh", ["-NoProfile", "-File", file, "-App", role], {
      encoding: "utf8", timeout: 12000, windowsHide: true,
    });
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, /DOCKER_ROLE_ANDROID_IDENTITY_REQUIRES_VERIFIED_LENOVO/);
  }
});

test("tunneled Operator Passkey opt-in requires the verified isolated Lenovo owner", () => {
  assert.match(launcher, /\[switch\]\$EnableIsolatedOperatorPasskeyPreview/);
  assert.match(launcher, /if \(\$EnableIsolatedOperatorPasskeyPreview -and !\$Surface\)/);
  assert.match(launcher, /\$EnableIsolatedOperatorPasskeyPreview -and \$App -ne 'control-panel'/);
  assert.match(launcher, /IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_RPID=localhost/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_ORIGINS=http:\/\/localhost:13000/);
  assert.ok(launcher.includes("'^identity_test_[a-z0-9_]+$'"));
  assert.match(launcher, /OPERATOR_PASSKEY_IDENTITY_PORT_NOT_LOOPBACK/);
  assert.match(launcher, /Assert-SurfaceCapability "\$identityOrigin\/v1\/operators\/passkey\/authentication\/options" 405/);
  assert.match(launcher, /\$env:OPERATOR_PASSKEY_BROWSER_ORIGIN='http:\/\/localhost:13000'/);
  assert.doesNotMatch(launcher, /-EnableIsolatedOperatorPasskeyPreview -Apply/);
});

test("first Root WebAuthn enrollment is a second explicitly opted-in localhost-only capability", () => {
  assert.match(launcher, /\[switch\]\$EnableIsolatedRootBootstrap/);
  assert.match(launcher, /\$EnableIsolatedRootBootstrap -and !\$EnableIsolatedOperatorPasskeyPreview/);
  assert.match(launcher, /OPERATOR_ROOT_BOOTSTRAP_REQUIRES_EXPLICIT_PASSKEY_PREVIEW/);
  assert.match(launcher, /IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true/);
  assert.match(launcher, /OPERATOR_ROOT_BOOTSTRAP_OWNER_NOT_OPTED_IN/);
  assert.match(launcher, /\$identityOrigin\/v1\/operators\/passkey\/bootstrap\/options/);
  assert.match(launcher, /if \(\$EnableIsolatedRootBootstrap\) \{\s+Assert-SurfaceCapability "\$identity\/v1\/operators\/passkey\/bootstrap\/options" 405\s+Assert-SurfaceCapability "\$identity\/v1\/operators\/passkey\/bootstrap" 405/);
  assert.match(launcher, /\$env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='false'/);
  assert.match(launcher, /\$env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='true'/);
});
