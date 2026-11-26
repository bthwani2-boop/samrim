import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("./Start-App.ps1", import.meta.url));
const launcher = readFileSync(file, "utf8");

test("the Lenovo launcher assigns the process to a non-inheritable job at creation", (t) => {
  if (process.platform !== "win32") return t.skip("Windows native job test");
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const dir = mkdtempSync(join(tmpdir(), "bthwani-app-job-"));
  const stdout = join(dir, "stdout.log");
  const stderr = join(dir, "stderr.log");
  const command = [
    "$ErrorActionPreference='Stop';$tokens=$null;$errors=$null",
    '$ast=[Management.Automation.Language.Parser]::ParseFile(' + quote(file) + ',[ref]$tokens,[ref]$errors)',
    "$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-OwnedAppProcess'},$true)",
    "if(!$fn){throw 'JOB_FUNCTION_MISSING'};Invoke-Expression $fn.Extent.Text",
    "exit (Invoke-OwnedAppProcess -Executable " + quote(process.execPath) + " -Arguments @('-e','console.log(process.argv[1]);console.error(\"ERR\");process.exit(17)','space and \"quote\"') -WorkingDirectory " + quote(dir) + " -Stdout " + quote(stdout) + " -Stderr " + quote(stderr) + ")",
  ].join("; ");
  const run = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(command, "utf16le").toString("base64")], {encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(run.status, 17, run.stderr || run.error?.message);
  assert.match(readFileSync(stdout, "utf8"), /space and "quote"/);
  assert.match(readFileSync(stderr, "utf8"), /ERR/);
  assert.match(launcher, /\$nativeExit=Invoke-OwnedAppProcess/);
  assert.match(launcher, /new IntPtr\(0x2000D\)/);
});

test("the Lenovo job releases both fixture descendants when its owner exits", {timeout:30000}, async (t) => {
  if (process.platform !== "win32") return t.skip("Windows native job test");
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const dir = mkdtempSync(join(tmpdir(), "bthwani-app-tree-"));
  const stdout = join(dir, "stdout.log"), stderr = join(dir, "stderr.log");
  const fixture = join(dir, "fixture.cjs");
  writeFileSync(fixture, [
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',__filename],{stdio:'ignore',windowsHide:true});",
    "child.once('spawn',()=>console.log('PIDS='+process.pid+','+child.pid));",
    "setInterval(()=>{},1000);",
  ].join("\n"));
  const command = [
    "$ErrorActionPreference='Stop';$tokens=$null;$errors=$null",
    '$ast=[Management.Automation.Language.Parser]::ParseFile(' + quote(file) + ',[ref]$tokens,[ref]$errors)',
    "$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-OwnedAppProcess'},$true)",
    "if(!$fn){throw 'JOB_FUNCTION_MISSING'};Invoke-Expression $fn.Extent.Text",
    "exit (Invoke-OwnedAppProcess -Executable " + quote(process.execPath) + " -Arguments @(" + quote(fixture) + ") -WorkingDirectory " + quote(dir) + " -Stdout " + quote(stdout) + " -Stderr " + quote(stderr) + ")",
  ].join("; ");
  const host = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command,"utf16le").toString("base64")], {windowsHide:true,stdio:["ignore","ignore","pipe"]});
  let err="", ids=[];
  host.stderr.setEncoding("utf8").on("data",chunk=>{err+=chunk;});
  const alive = pid => {try{process.kill(pid,0);return true;}catch(error){if(error.code==="ESRCH")return false;throw error;}};
  try {
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      const line=existsSync(stdout)?readFileSync(stdout,"utf8"):"";
      const match=line.match(/PIDS=(\d+),(\d+)/);
      if(match){ids=match.slice(1).map(Number);break;}
      if(host.exitCode!==null)break;
      await delay(100);
    }
    assert.equal(ids.length,2,err||"fixture not ready");
    assert.ok(ids.every(alive),"both fixture descendants initially exist");
    assert.ok(host.kill(),"stop only the disposable host");
    const deadlineStop=Date.now()+8000;
    while(Date.now()<deadlineStop&&ids.some(alive))await delay(100);
    assert.ok(ids.every(pid=>!alive(pid)),"fixture descendants survived their job");
  } finally {
    if(host.exitCode===null&&host.signalCode===null)host.kill();
    const cleanup="$fixture="+quote(fixture)+";Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixture) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }";
    spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(cleanup,"utf16le").toString("base64")],{timeout:8000,windowsHide:true});
  }
});
test("the Lenovo Metro memory ceiling is scoped to Customer and Merchant Web only", () => {
  assert.match(launcher, /\$env:NODE_OPTIONS='--dns-result-order=ipv4first'/);
  assert.match(launcher, /if \(\$App -in @\('customer','merchant'\)\)/);
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

test("Lenovo Android Customer Identity rejects a different app before startup", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell launcher checked on Surface");
  for (const selection of [["-App", "merchant"]]) {
    const result = spawnSync("pwsh", [
      "-NoProfile", "-File", file, ...selection, "-EnableDockerCustomerAndroidIdentityPreview",
    ], { encoding: "utf8", timeout: 12000, windowsHide: true });
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /DOCKER_ANDROID_IDENTITY_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY/);
  }
});

test("native Expo proxy follows the canonical Surface port map, not duplicate literals", () => {
  assert.equal((launcher.match(/\$env:EXPO_PACKAGER_PROXY_URL\s*=/g)||[]).length, 1);
  assert.doesNotMatch(launcher, /\$env:EXPO_PACKAGER_PROXY_URL\s*=\s*'http:\/\/127\.0\.0\.1:\d+'/);
  const block = launcher.match(/if \(\$EnableDockerCustomerAndroidIdentityPreview -or \$App -in @\('merchant','captain'\)\) \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(block, "one admitted native manifest proxy assignment");
  if (process.platform !== "win32") return;
  const ps = "$ErrorActionPreference='Stop';$developmentPorts=@{apps=@{customer=@{surface=19101};merchant=@{surface=19102};captain=@{surface=19103};'control-panel'=@{surface=14000}}};" +
    "foreach($App in @('customer','merchant','captain','control-panel')){foreach($EnableDockerCustomerAndroidIdentityPreview in @(($App -eq 'customer'),$false)){Remove-Item Env:EXPO_PACKAGER_PROXY_URL -ErrorAction SilentlyContinue;" + block +
    ";$expected=if($EnableDockerCustomerAndroidIdentityPreview -or $App -in @('merchant','captain')){'http://127.0.0.1:'+$developmentPorts.apps[$App].surface}else{$null};if($env:EXPO_PACKAGER_PROXY_URL -ne $expected){throw ('PROXY_MISMATCH '+$App)}}}";
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
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
  assert.match(launcher, /CAPTAIN_NATIVE_ADMISSION_DISABLED_DSH_ROUTE_NOT_ACTIVATED/);
  assert.match(launcher, /status=404\$/);
  assert.match(launcher, /\$env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN='http:\/\/127\.0\.0\.1:3201'\s+if \(\$captainStandingReady\)/);
  assert.doesNotMatch(launcher, /Remove-Item Env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN/);
  assert.match(launcher, /Remove-Item Env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN/);
});

test("all daily applications reject a non-Lenovo host before startup", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell launcher checked on Surface");
  for (const role of ["customer", "merchant", "captain", "control-panel"]) {
    const result = spawnSync("pwsh", ["-NoProfile", "-File", file, "-App", role], {
      encoding: "utf8", timeout: 12000, windowsHide: true,
    });
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, /APP_LAUNCH_REQUIRES_VERIFIED_LENOVO_HOST/);
  }
});

test("tunneled Operator Passkey opt-in requires the verified isolated Lenovo owner", () => {
  assert.match(launcher, /\[switch\]\$EnableIsolatedOperatorPasskeyPreview/);
  assert.match(launcher, /if \(\$EnableIsolatedOperatorPasskeyPreview\)/);
  assert.match(launcher, /\$EnableIsolatedOperatorPasskeyPreview -and \$App -ne 'control-panel'/);
  assert.match(launcher, /IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_RPID=localhost/);
  assert.match(launcher, /IDENTITY_OPERATOR_PASSKEY_ORIGINS=http:\/\/localhost:13000/);
  assert.ok(launcher.includes("'^identity_test_[a-z0-9_]+$'"));
  assert.match(launcher, /OPERATOR_PASSKEY_IDENTITY_PORT_NOT_LOOPBACK/);
  assert.match(launcher, /Assert-OwnerEndpoint "\$identityOrigin\/v1\/operators\/passkey\/authentication\/options" 405/);
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
  assert.match(launcher, /Assert-OwnerEndpoint "\$identityOrigin\/v1\/operators\/passkey\/bootstrap\/options" 405\s+Assert-OwnerEndpoint "\$identityOrigin\/v1\/operators\/passkey\/bootstrap" 405/);
  assert.match(launcher, /\$env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='false'/);
  assert.match(launcher, /\$env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='true'/);
});

test("Operator finance projection is enabled only for the matching verified isolated WLT owner", () => {
  assert.match(launcher, /Remove-Item Env:OPERATOR_FINANCE_WLT_ORIGIN -ErrorAction SilentlyContinue/);
  const boundary = launcher.slice(launcher.indexOf("# Finance readback uses the same shared isolated Identity"));
  assert.match(boundary, /if \(!\$UseDisposableOperatorSandbox\)/);
  assert.match(boundary, /WLT_TEST_IDENTITY_ORIGIN=http:\/\/identity:3302/);
  assert.match(boundary, /\$wltOwner\.Config\.Labels\.'com\.docker\.compose\.project' -cne \$identityOwner\.Config\.Labels\.'com\.docker\.compose\.project'/);
  assert.match(boundary, /\$wltBindings\[0\]\.HostIp -cne '127\.0\.0\.1'/);
  assert.match(boundary, /Assert-OwnerEndpoint 'http:\/\/127\.0\.0\.1:3203\/v1\/operators\/stores\/capability-probe\/commercial-agreement' 401\s+\$env:OPERATOR_FINANCE_WLT_ORIGIN='http:\/\/127\.0\.0\.1:3203'/);
  assert.match(boundary, /Write-Warning 'OPERATOR_FINANCE_WLT_READBACK_UNAVAILABLE'/);
});


test("Lenovo owner startup waits for readiness and fails closed at its deadline", (t) => {
  if (process.platform !== "win32") return t.skip("PowerShell startup check");
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const command = [
    "$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest; $tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile(" + quote(file) + ",[ref]$tokens,[ref]$errors)",
    "$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-LenovoOwnerHealth'},$true)",
    "if(!$fn){throw 'OWNER_READINESS_FUNCTION_MISSING'}; . ([scriptblock]::Create($fn.Extent.Text))",
    "$script:calls=0; Wait-LenovoOwnerHealth -Owners @('identity','dsh') -TimeoutSeconds 2 -PollMilliseconds 10 -Probe {param($owners) if(($owners -join ',') -cne 'identity,dsh'){throw 'OWNER_SCOPE_CHANGED'}; $script:calls++; if($script:calls -lt 3){'starting';'healthy'}else{'healthy';'healthy'}}",
    "if($script:calls -ne 3){throw 'STARTED_BEFORE_ALL_OWNERS_HEALTHY'}",
    "$blocked=$false;try{Wait-LenovoOwnerHealth -Owners @('identity','dsh') -TimeoutSeconds 1 -PollMilliseconds 10 -Probe {param($owners) 'healthy'}}catch{if($_.Exception.Message -notmatch '^LENOVO_OWNER_READINESS_TIMEOUT'){throw};$blocked=$true};if(!$blocked){throw 'PARTIAL_OWNER_READINESS_ACCEPTED'}",
    "Write-Output 'READINESS_FIXTURE_PASS'",
  ].join("; ");
  const run = spawnSync("pwsh", ["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(command,"utf16le").toString("base64")], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout || run.error?.message);
  assert.match(run.stdout, /READINESS_FIXTURE_PASS/);
});

test("daily launcher has one Lenovo execution path and no persistent Surface preview configuration",()=>{
  assert.match(launcher,/^#Requires -Version 7\.0/);
  assert.doesNotMatch(launcher,/\$Surface\b|\$EnableAndroidWalletPreview\b|surface-preview-logs|2310[0-3]|2320[1-3]/);
  assert.doesNotMatch(launcher,/BTHWANI_SURFACE_PREVIEW/);
  const scrub=launcher.indexOf('Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN');
  assert.ok(scrub>=0 && scrub<launcher.indexOf('function Invoke-OwnedAppProcess'), 'daily launcher must clear any emulator fixture WLT origin before owner selection');
  assert.equal((launcher.match(/\$nativeExit=Invoke-OwnedAppProcess/g)||[]).length,1);
  const ports=JSON.parse(readFileSync(new URL("./ports.json",import.meta.url),"utf8"));
  assert.ok(Object.values(ports.apps).every(a=>!Object.hasOwn(a,"preview")));
});
