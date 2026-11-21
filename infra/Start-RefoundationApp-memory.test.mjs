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

test("Operator Passkey launcher opt-in fails closed outside verified isolated Lenovo owner", () => {
  assert.match(launcher, /\[switch\]\$EnableIsolatedOperatorPasskeyPreview/);
  assert.match(launcher, /if \(\$EnableIsolatedOperatorPasskeyPreview\)/);
  assert.match(launcher, /\$Surface -or \$App -ne 'control-panel'/);
  assert.match(launcher, /IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_RPID=localhost/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_ORIGINS=http:\/\/localhost:13000/);
  assert.ok(launcher.includes("'^identity_test_[a-z0-9_]+$'"));
  assert.match(launcher, /OPERATOR_PASSKEY_IDENTITY_PORT_NOT_LOOPBACK/);
  assert.match(launcher, /'http:\/\/127\.0\.0\.1:3201\/v1\/operators\/passkey\/authentication\/options' 405/);
  assert.match(launcher, /\$env:OPERATOR_PASSKEY_BROWSER_ORIGIN='http:\/\/localhost:13000'/);
  assert.doesNotMatch(launcher, /-EnableIsolatedOperatorPasskeyPreview -Apply/);
});
