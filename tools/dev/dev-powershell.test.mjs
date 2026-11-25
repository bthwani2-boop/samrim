import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dev.ps1");

test("manual Lenovo control pins the same OpenSSH executables as the tunnel and source watcher", () => {
  const helper = readFileSync(new URL("./Control-Lenovo-SSH.ps1", import.meta.url), "utf8");
  assert.match(helper, /\$sshClient = Join-Path \$env:WINDIR 'System32\\OpenSSH\\ssh\.exe'/);
  assert.match(helper, /\$scpClient = Join-Path \$env:WINDIR 'System32\\OpenSSH\\scp\.exe'/);
  assert.match(helper, /& \$sshClient -T -o BatchMode=yes -o StrictHostKeyChecking=yes/);
  assert.equal((helper.match(/& \$scpClient @args/g) || []).length, 2);
  assert.doesNotMatch(helper, /& (?:ssh|scp)\.exe\b/);
  assert.match(helper, /'node\.exe','git\.exe','pnpm','winget\.exe'/);
  assert.match(helper, /Get-Command \$n -CommandType Application -ErrorAction SilentlyContinue \| Select-Object -First 1/);
  assert.doesNotMatch(helper, /'pnpm\.cmd'/);

});


test("opening Chrome and Android is owned by the single dev launcher", () => {
  assert.equal(existsSync(new URL("./open-dev-apps.ps1", import.meta.url)), false);
});

test("the Android Expo manifest check identifies the native platform", () => {
  const opener = readFileSync(scriptPath, "utf8");
  assert.match(opener, /'Expo-Platform: '\s*\+\s*\$platform/);
  assert.match(opener, /\$manifest=Probe[^\r\n]*'application\/expo\+json'\s+'android'/);
  assert.doesNotMatch(opener, /Start-Sleep -Seconds 3/);
});

test("Chrome reuses the intended customer, merchant and operator tabs when Expo shows a URL title", () => {
  const opener = readFileSync(scriptPath, "utf8");
  const expected = opener.match(/\$expected=@\(([\s\S]*?)\r?\n\s*\)/);
  assert.ok(expected, "Chrome tab signatures must be declared");
  const patterns = [...expected[1].matchAll(/'([^']+)'/g)]
    .map(([, source]) => new RegExp(source.replace(/^\(\?i\)/, ""), "i"));
  assert.equal(patterns.length, 3);

  const validTitles = [
    "127.0.0.1:18101 - Memory usage - 30 MB",
    "بثواني — التاجر",
    "بثواني — لوحة التحكم",
  ];
  for (let i = 0; i < patterns.length; i++) {
    assert.match(validTitles[i], patterns[i]);
    assert.doesNotMatch(validTitles[(i + 1) % patterns.length], patterns[i]);
  }
  assert.match("بثواني — الرئيسية", patterns[0]);
  assert.match("127.0.0.1:18102", patterns[1]);
  assert.match("127.0.0.1:13000", patterns[2]);
  assert.match(opener, /\$tabs\.Count -lt 3/);
  assert.match(opener, /foreach\(\$signature in \$expected\)/);
  assert.match(opener, /\$matched\.Count -eq \$expected\.Count/);
  assert.doesNotMatch(opener, /bthwani2@gmail\.com/);
});

test("Operator opens at the exact WebAuthn localhost origin and reports auth readiness separately", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /'http:\/\/localhost:13000\/'/);
  assert.match(launcher, /function Show-OperatorAuthReadiness\b/);
  assert.match(launcher, /'http:\/\/localhost:13000\/api\/auth\/session'/);
  assert.match(launcher, /'OPERATOR_AUTH'/);
  assert.match(launcher, /'launch'\s*\{[\s\S]*?Open-AppSurfaces\s+Show-OperatorAuthReadiness/);
});

test("one dev command opens existing app surfaces after the owner tasks are ready", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /function Open-AppSurfaces\b/);
  assert.match(launcher, /\[string\]\$Action = 'Launch'/);
  const fastPath = launcher.match(/'launch'\s*\{([\s\S]*?)\n\s*break/);
  assert.ok(fastPath, "default launch action must be present");
  assert.match(fastPath[1], /Check-Ssh[\s\S]*?Start-LocalTasks[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces/);
  // Open existing surfaces first; do not recreate infrastructure in the fast path.
  assert.match(fastPath[1], /Open-AppSurfaces[\s\S]*Check-DockerContext[\s\S]*Assert-EnvironmentReady/);
  assert.doesNotMatch(fastPath[1], /Start-Base|Start-DSHIfVerified|Stop-Docker/);
  assert.match(launcher, /'up'\s*\{[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces[\s\S]*?break/);
  assert.match(launcher, /'warm'\s*\{[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces[\s\S]*?break/);
  assert.match(launcher, /if\s*\(\$DockerAction -eq 'open'\)\s*\{Open-AppSurfaces;Show-OperatorAuthReadiness;return\}/);
  assert.match(launcher, /if\s*\(\$selection -eq 'All'\)/);
  assert.match(launcher, /'SAMSUNG' 'SKIPPED/);
});

test("native owner traffic reuses the verified SSH tunnel and cannot take over an arbitrary ADB port", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const tunnel = readFileSync(new URL("./Start-AppTunnel.ps1", import.meta.url), "utf8");
  assert.match(tunnel, /if \(\$App -eq 'customer'\)/);
  assert.match(tunnel, /foreach \(\$ownerPort in @\(3201,3202\)\)/);
  assert.match(tunnel, /'127\.0\.0\.1:' \+ \$ownerPort/);
  assert.match(tunnel, /\$argsList \+= \$target/);
  assert.match(launcher, /\$nativePorts = @\(\$android \| ForEach-Object/);
  assert.match(launcher, /NATIVE_OWNER_SSH_TUNNEL_NOT_LISTENING/);
  assert.match(launcher, /NATIVE_OWNER_SSH_TUNNEL_UNVERIFIED/);
  assert.match(launcher, /ADB_REVERSE_COLLISION/);
  assert.match(launcher, /18101,18102,18103,3201,3202/);
});

test("Web and Metro readiness share endpoints and report bounded cold-start retries", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const targets = launcher.match(/function Get-AppHttpTargets \{([\s\S]*?)\n\}/);
  assert.ok(targets, "one endpoint inventory must serve both status and verification");
  for (const port of [18101, 18102, 18103, 13000]) {
    assert.match(targets[1], new RegExp(String(port)));
  }
  assert.match(launcher, /function Test-AppHttpTarget\b/);
  assert.match(launcher, /\$attempt -le \$MaxAttempts/);
  assert.match(launcher, /\$attempt -lt \$MaxAttempts/);
  assert.match(launcher, /\$result\.Success/);
  assert.match(launcher, /\$result\.Error/);
  assert.match(launcher, /elapsedMs=/);
  assert.match(launcher, /-MaxAttempts 3/);
  assert.match(launcher, /-MaxAttempts 1/);
  assert.match(launcher, /Assert-Ok \(\$failures -eq 0\)/);
});

test("transient HTTP failure recovers and persistent failure remains negative", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$source=Get-Content -LiteralPath '${quoted}' -Raw`,
    "$tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
    "$node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-AppHttpTarget'},$true)",
    "if(!$node){throw 'PROBE_FUNCTION_MISSING'}",
    "Invoke-Expression $node.Extent.Text",
    "function Invoke-WebRequest { param([switch]$UseBasicParsing,[switch]$SkipHttpErrorCheck,[string]$Uri,[int]$TimeoutSec) $script:tries++; if($script:alwaysFail -or $script:tries -eq 1){throw 'temporary failure'}; return [pscustomobject]@{StatusCode=200} }",
    "$target=@{A='test';U='http://not-used.invalid/'}",
    "$script:tries=0;$script:alwaysFail=$false",
    "$recovered=Test-AppHttpTarget -Target $target -MaxAttempts 3 -TimeoutSec 1 -RetryDelayMs 0",
    "if(!$recovered.Success -or $recovered.Attempts -ne 2 -or $script:tries -ne 2){throw 'TRANSIENT_NOT_RECOVERED'}",
    "$script:tries=0;$script:alwaysFail=$true",
    "$failed=Test-AppHttpTarget -Target $target -MaxAttempts 3 -TimeoutSec 1 -RetryDelayMs 0",
    "if($failed.Success -or $failed.Attempts -ne 3 -or $script:tries -ne 3 -or !$failed.Error){throw 'PERSISTENT_FAILURE_MASKED'}",
    "Write-Output 'RETRY_AND_FAIL_CLOSED_PASS'",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RETRY_AND_FAIL_CLOSED_PASS/);
});

test("Expo readiness rejects an unknown-module error document even with HTTP 200", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$source=Get-Content -LiteralPath '${quoted}' -Raw`,
    "$tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
    "$node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-AppHttpTarget'},$true)",
    "Invoke-Expression $node.Extent.Text",
    "function Invoke-WebRequest { param([switch]$UseBasicParsing,[switch]$SkipHttpErrorCheck,[string]$Uri,[int]$TimeoutSec) return [pscustomobject]@{StatusCode=$script:status;Content=$script:body} }",
    "$target=@{A='customer';U='http://not-used.invalid/'}",
    "$script:status=200;$script:body='<html><body>Server Error: Requiring unknown module &quot;60&quot;. unknownModuleError</body></html>'",
    "$failed=Test-AppHttpTarget -Target $target -MaxAttempts 1",
    "if($failed.Success -or $failed.Error -ne 'EXPO_UNKNOWN_MODULE'){throw 'EXPO_ERROR_DOCUMENT_ACCEPTED'}",
    "$target.A='merchant';$script:status=500",
    "$failed=Test-AppHttpTarget -Target $target -MaxAttempts 1",
    "if($failed.Success -or $failed.Error -ne 'EXPO_UNKNOWN_MODULE'){throw 'EXPO_ERROR_STATUS_NOT_DIAGNOSED'}",
    "$script:status=200;$script:body='<html lang=ar dir=rtl><body>Merchant</body></html>'",
    "$healthy=Test-AppHttpTarget -Target $target -MaxAttempts 1",
    "if(!$healthy.Success){throw 'HEALTHY_WEB_REJECTED'}",
    "Write-Output 'EXPO_ERROR_DOCUMENT_REJECTED'",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EXPO_ERROR_DOCUMENT_REJECTED/);
});

test("Docker status verifies present WLT without misreporting it as another project", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /--include-wlt/);
  assert.match(launcher, /bthwani-refoundation-wlt-1/);
  assert.match(launcher, /\[ValidateSet\('dsh','identity','wlt','postgres','media','mailpit','payment-mock'\)\]/);
  assert.match(launcher, /pnpm dev docker logs wlt/);
  assert.doesNotMatch(launcher, /WLT.*outside this Docker project/);
});

test("strict Docker verification and complete environment verification share the owner and Compose checks", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const owner = launcher.match(/function Assert-OwnerRuntime \{([\s\S]*?)\n\}/);
  assert.ok(owner);
  assert.match(owner[1], /verify-runtime-provenance\.mjs'\) '--context' \$dockerContext '--include-wlt'/);
  assert.match(owner[1], /Assert-Ok \(\$LASTEXITCODE -eq 0\)/);
  const config = launcher.match(/function Assert-CompleteCompose \{([\s\S]*?)\n\}/);
  assert.ok(config);
  for (const input of ["$baseCompose", "$appCompose", "compose.identity.yaml", "compose.merchant.yaml", "compose.captain.yaml", "compose.wlt.yaml"]) {
    assert.ok(config[1].includes(input), "missing Compose input " + input);
  }
  for (const profile of ["implementation", "identity-verifier", "wlt-reader"]) assert.ok(config[1].includes("'" + profile + "'"));
  assert.match(config[1], /'config','--quiet'/);
  assert.doesNotMatch(config[1], /'up'|'run'|'bootstrap'/);
  const scoped = launcher.match(/function Invoke-ScopedDocker \{([\s\S]*?)\n\}/);
  assert.ok(scoped);
  assert.match(scoped[1], /'config' \{ Assert-CompleteCompose \}/);
  assert.match(scoped[1], /'verify' \{ Assert-OwnerRuntime \}/);
  const main = launcher.slice(launcher.indexOf("switch ($Action.ToLowerInvariant())"));
  for (const action of ["launch", "up", "warm", "verify"]) {
    const branch = main.match(new RegExp("'" + action + "'\\s*\\{([\\s\\S]*?)\\n\\s*break"));
    assert.ok(branch);
    assert.match(branch[1], /Assert-EnvironmentReady/);
  }
});

test("environment readiness reports all independent failures and never certifies a partial result", {
  skip: process.platform !== "win32",
}, () => {
  const quoted=scriptPath.replaceAll("'", "''");
  const ps=[
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$err=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('" + quoted + "',[ref]$tok,[ref]$err)",
    "foreach($name in @('Assert-Ok','Say','Assert-EnvironmentReady')){$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);if(!$fn){throw 'MISSING_HELPER'};Invoke-Expression $fn.Extent.Text}",
    "$script:visited=@();$script:fail=@('Assert-OwnerRuntime','Assert-AppRuntime')",
    "function Assert-CompleteCompose {$script:visited+='Assert-CompleteCompose';if($script:fail -contains 'Assert-CompleteCompose'){throw 'fixture config failure'}}",
    "function Assert-OwnerRuntime {$script:visited+='Assert-OwnerRuntime';if($script:fail -contains 'Assert-OwnerRuntime'){throw 'fixture stale WLT'}}",
    "function Assert-AppRuntime {$script:visited+='Assert-AppRuntime';if($script:fail -contains 'Assert-AppRuntime'){throw 'fixture broken web'}}",
    "$rejected=$false;try{Assert-EnvironmentReady}catch{$rejected=$_.Exception.Message -match 'environment incomplete'};if(!$rejected){throw 'PARTIAL_ACCEPTED'}",
    "if(($script:visited -join ',') -ne 'Assert-CompleteCompose,Assert-OwnerRuntime,Assert-AppRuntime'){throw 'INDEPENDENT_CHECKS_SKIPPED'}",
    "$script:visited=@();$script:fail=@();Assert-EnvironmentReady",
    "Write-Output 'ENVIRONMENT_READINESS_REGRESSION_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/READINESS_BLOCKED=Assert-OwnerRuntime/);
  assert.match(result.stdout,/READINESS_BLOCKED=Assert-AppRuntime/);
  assert.equal((result.stdout.match(/ENVIRONMENT_READINESS=PASS/g)||[]).length,1);
  assert.match(result.stdout,/ENVIRONMENT_READINESS_REGRESSION_PASS/);
});
test("down preflights all Docker peers before stopping any applications or tunnels", {
  skip: process.platform !== "win32",
}, () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const down = launcher.match(/'down'\s*\{([\s\S]*?)\n\s*break/);
  assert.ok(down);
  assert.match(down[1], /Get-DockerStopPlan[\s\S]*Stop-LenovoTasks[\s\S]*Stop-LocalTasks[\s\S]*Stop-Docker/);
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'; $project='bthwani-refoundation'",
    "$tok=$null;$err=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('" + quoted + "',[ref]$tok,[ref]$err)",
    "foreach($name in @('Assert-Ok','Get-DockerStopPlan')){$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);if(!$fn){throw 'MISSING_HELPER'};Invoke-Expression $fn.Extent.Text}",
    "function Invoke-DockerCli($argsList){if($argsList[0] -ne 'ps'){throw 'MUTATION_FORBIDDEN'}; $script:rows}",
    "function Row($id,$service,$state){($id*64)+'|'+$project+'-'+$service+'-1|'+$service+'|'+$state}",
    "$script:rows=@((Row a postgres running),(Row b dsh running),(Row c identity exited),(Row d wlt created))",
    "$plan=@(Get-DockerStopPlan);if(($plan.Name -join ',') -ne 'bthwani-refoundation-dsh-1,bthwani-refoundation-postgres-1'){throw 'STOP_ORDER_WRONG'}",
    "foreach($service in @('identity','wlt','unknown')){$script:rows=@((Row a postgres running),(Row b $service running));$rejected=$false;try{$null=@(Get-DockerStopPlan)}catch{$rejected=$_.Exception.Message -match 'BLOCKED'};if(!$rejected){throw ('UNSAFE_STOP '+$service)}}",
    "$script:rows=@((Row a postgres running),(Row b postgres running));$rejected=$false;try{$null=@(Get-DockerStopPlan)}catch{$rejected=$_.Exception.Message -match 'duplicate'};if(!$rejected){throw 'DUPLICATE_ACCEPTED'}",
    "Write-Output 'STOP_PREFLIGHT_POLICY_PASS'",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /STOP_PREFLIGHT_POLICY_PASS/);
});
test("read-only diagnostics do not monopolize the global app lifecycle mutex", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /\$readOnlyOperation\s*=/);
  assert.match(launcher, /'status','verify','logs','android'/);
  assert.match(launcher, /if\s*\(-not\s+\$readOnlyOperation\)\s*\{/);
});

test("an offline Lenovo fails quickly without weakening SSH host-key checks", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const check = launcher.match(/function Check-Ssh \{([\s\S]*?)\n\}/);
  assert.ok(check);
  assert.match(check[1], /ConnectAsync/);
  assert.match(check[1], /\.Wait\(2000\)/);
  assert.match(check[1], /StrictHostKeyChecking=yes/);
});

test("the existing package script replaces the obsolete self-install branch", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(root.scripts.dev, "pwsh -NoProfile -File tools/dev/dev.ps1");
  assert.doesNotMatch(launcher, /function Install-CLI/);
  assert.doesNotMatch(launcher, /'install'\s*\{\s*Install-CLI/);
});

test("Lenovo shutdown owns the complete pinned Node tree and rejects foreign descendants", {
  skip: process.platform !== "win32",
}, () => {
  const quoted=scriptPath.replaceAll("'", "''");
  const ps=[
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$err=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$err)`,
    "$block=$ast.Find({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match '^function Get-OwnedAppProcessTree'},$true)",
    "if(!$block){throw 'OWNED_TREE_HELPER_MISSING'}",
    "Invoke-Expression $block.Value",
    "$root='C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime';$node='C:\\Users\\bthwa\\BThwaniAppRunner\\tools\\node-v24.22.1-refoundation\\node.exe'",
    "$now=[datetime]'2026-11-24T00:00:00Z'",
    "function P($id,$parent,$name,$exe,$cmd,$seconds){[pscustomobject]@{ProcessId=$id;ParentProcessId=$parent;Name=$name;ExecutablePath=$exe;CommandLine=$cmd;CreationDate=$now.AddSeconds($seconds)}}",
    "$launcher=P 10 1 'pwsh.exe' 'C:\\Windows\\pwsh.exe' ('pwsh -File '+$root+'\\tools\\dev\\Start-App.ps1 -App control-panel') 0",
    "$parent=P 20 10 'node.exe' $node 'next dev' 1",
    "$child=P 30 20 'node.exe' $node 'next child' 2",
    "$other=P 40 1 'node.exe' $node 'unrelated' 1",
    "$console=P 45 10 'conhost.exe' (Join-Path $env:WINDIR 'System32\\conhost.exe') 'console' 1",
    "$tree=@(Get-OwnedAppProcessTree 'control-panel' @($launcher,$parent,$child,$other,$console) $root $node)",
    "if(($tree.ProcessId -join ',') -ne '10,20,30'){throw 'OWNED_DESCENDANTS_WRONG'}",
    "$reuse=P 30 20 'node.exe' $node 'next child' 4",
    "if(Test-SameOwnedAppProcess $child $reuse){throw 'REUSED_PID_ACCEPTED'}",
    "if(!(Test-SameOwnedAppProcess $child $child)){throw 'SAME_PID_REJECTED'}",
    "$foreign=P 50 20 'cmd.exe' 'C:\\Windows\\cmd.exe' 'foreign' 3",
    "$rejected=$false;try{Get-OwnedAppProcessTree 'control-panel' @($launcher,$parent,$child,$foreign) $root $node|Out-Null}catch{$rejected=$_.Exception.Message -match 'APP_TREE_FOREIGN'};if(!$rejected){throw 'FOREIGN_DESCENDANT_ACCEPTED'}",
    "Write-Output 'OWNED_APP_TREE_POLICY_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/OWNED_APP_TREE_POLICY_PASS/);
  const launcher=readFileSync(scriptPath,"utf8");
  assert.match(launcher,/function Stop-LenovoTasks[\s\S]*?Stop-OwnedAppTree/);
  assert.match(launcher,/function Control-SingleApp[\s\S]*?Stop-OwnedAppTree/);
});

test("the unified dev launcher and each embedded PowerShell block parse on Windows", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$errors=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$errors)`,
    "if($errors.Count){throw ('ROOT_PARSE '+($errors -join '|'))}",
    "$blocks=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType.ToString() -eq 'SingleQuotedHereString'},$true))",
    "if($blocks.Count -lt 6){throw ('MISSING_EMBEDDED_BLOCKS '+$blocks.Count)}",
    "foreach($block in $blocks){if($block.Value.TrimStart().StartsWith('using System;')){if($block.Value -notmatch 'BthwaniChromeWindowLocator'){throw 'CHROME_CSHARP_BLOCK_CHANGED'};continue};$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseInput($block.Value,[ref]$t,[ref]$e);if($e.Count){throw ('EMBEDDED_PARSE '+($e -join '|'))}}",
    "Write-Output ('EMBEDDED_PARSE_PASS blocks='+$blocks.Count)",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EMBEDDED_PARSE_PASS blocks=\d+/);
});


test("the app verifier detects missing workspace dependency links", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /APP_WORKSPACE_LINK_MISSING/);
  assert.ok(launcher.includes("workspace:*"));
  assert.ok(launcher.includes("Test-Path -LiteralPath $dependencyPackage -PathType Leaf"));
});

test("the Merchant launcher preserves existing Windows task identities", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /N='BThwani Partner Metro Native';A='merchant'/);
  assert.match(launcher, /A='merchant';N='BThwani Partner Metro Native'/);
  assert.match(launcher, /'merchant'=@\{N='BThwani Partner Metro Native'/);
  assert.doesNotMatch(launcher, /BThwani Merchant Metro Native/);
});

test("strict app verification checks the existing watcher and its mirrored source digests", () => {
  const launcher=readFileSync(scriptPath,"utf8");
  assert.match(launcher,/function Inspect-AppSourceSync\b/);
  assert.match(launcher,/Get-ScheduledTaskInfo -TaskName \$spec\.Name/);
  assert.match(launcher,/APP_SOURCE_SYNC/);
  assert.match(launcher,/'--verify-manifest'/);
  assert.match(launcher,/'verify'\s*\{Assert-AppRuntime\}/);
  assert.match(launcher,/function Assert-AppRuntime \{\s*Inspect-AppSourceSync -StrictCheck\s*Inspect-AppOwners -StrictCheck\s*Verify-AppWeb\s*\}/);
});
test("strict app verification distinguishes copied lockfile from installed dependency graph", () => {
  const launcher=readFileSync(scriptPath,"utf8");
  assert.match(launcher,/node_modules\\\.pnpm\\lock\.yaml/);
  assert.match(launcher,/APP_INSTALLED_DEPENDENCIES/);
  assert.match(launcher,/APP_INSTALLED_LOCK_MISMATCH/);
  assert.match(launcher,/\$installedMatch/);
});

test("owner baseline reconciliation forwards one intact native option", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$errors=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$errors)`,
    "$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$reconcileOptions'},$true)",
    "if(!$assignment){throw 'MISSING_RECONCILE_OPTIONS'}",
    "$CutoverDshDatabase=$false;$PrepareBaseline=$true;$mode='--apply-preview'",
    "Invoke-Expression $assignment.Extent.Text",
    "$actual=& node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- $mode @reconcileOptions",
    "if($LASTEXITCODE -ne 0){throw 'NATIVE_ARGUMENT_PROBE_FAILED'}",
    "$actual",
    "$PrepareBaseline=$false",
    "Invoke-Expression $assignment.Extent.Text",
    "$actual=& node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- $mode @reconcileOptions",
    "if($LASTEXITCODE -ne 0){throw 'NATIVE_ARGUMENT_PROBE_FAILED'}",
    "$actual",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const actual = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(actual, [["--apply-preview", "--prepare-baseline"], ["--apply-preview"]]);
});

test("pnpm package-manager lock document is excluded but workspace changes are not", {
  skip: process.platform !== "win32",
},()=>{
  const quoted=scriptPath.replaceAll("'","''");
  const ps=[
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$err=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$err)`,
    "$block=$ast.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType.ToString() -eq 'SingleQuotedHereString'},$true) | Where-Object {$_.Value -match 'function Get-WorkspaceLockDocument'} | Select-Object -First 1",
    "if(!$block){throw 'MISSING_LOCK_PROOF'}",
    "$t=$null;$e=$null;$inner=[Management.Automation.Language.Parser]::ParseInput($block.Value,[ref]$t,[ref]$e)",
    "$fn=$inner.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WorkspaceLockDocument'},$true)",
    "Invoke-Expression $fn.Extent.Text",
    "$nl=[string][char]10;$crlf=[string][char]13+[char]10",
    "$workspace=@('lockfileVersion: 9.0','importers:','  .:','    dependencies:','      sample:','        version: 1.0.0') -join $nl",
    "$full=@('---','lockfileVersion: 9.0','importers:','  .:','    packageManagerDependencies: {}','---',$workspace) -join $crlf",
    "if((Get-WorkspaceLockDocument $full) -cne (Get-WorkspaceLockDocument $workspace)){throw 'IDENTICAL_WORKSPACE_REJECTED'}",
    "if((Get-WorkspaceLockDocument $full) -ceq (Get-WorkspaceLockDocument ($workspace.Replace('1.0.0','2.0.0')))){throw 'STALE_GRAPH_ACCEPTED'}",
    "$invalid=$false;try{Get-WorkspaceLockDocument 'invalid' | Out-Null}catch{$invalid=$true};if(!$invalid){throw 'MALFORMED_LOCK_ACCEPTED'}",
    "Write-Output 'WORKSPACE_LOCK_PROOF_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/WORKSPACE_LOCK_PROOF_PASS/);
});

test("dependency reconcile uses the existing lifecycle and only retries changed or explicitly requested inputs", () => {
  const source=readFileSync(scriptPath,"utf8");
  const watch=readFileSync(new URL("./sync-lenovo-source.mjs",import.meta.url),"utf8");
  assert.match(source,/function Invoke-AppDependencyReconcile[\s\S]*?--verify-dependency-inputs/);
  assert.match(source,/DEPENDENCY_FAILED_SAME_INPUT_MANUAL_RETRY_REQUIRED/);
  assert.match(source,/DEPENDENCY_PREVIOUS_ATTEMPT_REQUIRES_READBACK/);
  assert.match(source,/Stop-OwnedAppTree \$plan\.Spec\.N/);
  assert.match(source,/install --frozen-lockfile --prefer-offline/);
  assert.match(source,/DEPENDENCY_ROLLBACK_LOCK_CHANGED/);
  assert.match(watch,/if\(runtimeChild\)return;/);
  assert.match(watch,/\"Apps\",\"reconcile\",\"-Apply\",\"-Automatic\"/);
  assert.match(watch,/cycle\(\);\s*try \{ pollAppDependencies\(\)/);
});

test("app log diagnostics read a bounded tail and never emit partial or secret lines", {
  skip: process.platform !== "win32",
}, () => {
  const quoted=scriptPath.replaceAll("'","''");
  const ps=[
    "$ErrorActionPreference='Stop';$t=$null;$e=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$t,[ref]$e)",
    "$owner=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Show-AppLogs'},$true)",
    "$block=$owner.Body.Find({param($n)$n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType.ToString() -eq 'SingleQuotedHereString'},$true)",
    "$inner=[Management.Automation.Language.Parser]::ParseInput($block.Value,[ref]$t,[ref]$e)",
    "$fn=$inner.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Read-BoundedAppLog'},$true)",
    "if(!$fn){throw 'MISSING_BOUNDED_LOG_READER'}",
    "Invoke-Expression $fn.Extent.Text",
    "$f=[IO.Path]::GetTempFileName();$nl=[string][char]10",
    "try {",
    "$data=('x'*2000000)+$nl+('Bearer fixture-token'+$nl)+('password=fixture-password'+$nl)+('z'*400)+$nl+'token=partial-unfinished'",
    "[IO.File]::WriteAllText($f,$data,[Text.UTF8Encoding]::new($false))",
    "$lines=@(Read-BoundedAppLog $f);$joined=$lines -join $nl",
    "if($joined -match 'fixture-token|fixture-password|partial-unfinished|x{5}' -or $joined -notmatch 'Bearer \\[REDACTED\\]' -or $joined -notmatch 'password=\\[REDACTED\\]'){throw 'LOG_REDACTION_OR_PARTIAL_BOUNDARY_FAILED'}",
    "if(@($lines|Where-Object {$_.Length -gt 300}).Count -or $joined -notmatch 'z{300}'){throw 'LOG_OUTPUT_LIMIT_FAILED'}",
    "[IO.File]::WriteAllText($f,((1..30|ForEach-Object{'line-'+$_}) -join $nl)+$nl,[Text.Encoding]::Unicode)",
    "$lines=@(Read-BoundedAppLog $f);if($lines.Count -ne 20 -or $lines[0] -cne 'line-11' -or $lines[-1] -cne 'line-30'){throw 'LOG_LINE_LIMIT_OR_ENCODING_FAILED'}",
    "[IO.File]::WriteAllText($f,('a'*2000000),[Text.UTF8Encoding]::new($false))",
    "$lines=@(Read-BoundedAppLog $f);if($lines.Count -ne 1 -or $lines[0] -cne 'APP_LOG_NO_COMPLETE_LINES'){throw 'LOG_OVERSIZED_LINE_FAILED'}",
    "[IO.File]::WriteAllText($f,'');if(@(Read-BoundedAppLog $f).Count){throw 'LOG_EMPTY_FILE_FAILED'}",
    "Write-Output 'BOUNDED_LOG_READER_PASS'",
    "} finally { [IO.File]::Delete($f) }",
  ].join("\n");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/BOUNDED_LOG_READER_PASS/);
});

test("Surface identity uses the actual Windows host and rejects contradictory environment claims", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$source=Get-Content -LiteralPath '${quoted}' -Raw`,
    "$tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
    "foreach($name in @('Assert-Ok','Assert-SurfaceIdentity','Check-LocalIdentity')){$n=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if($n){Invoke-Expression $n.Extent.Text}}",
    "function Test-Path { return $true }; function Git { if($argsList -contains 'branch'){return 'test-branch'};return 'test-head' }; function Say {}",
    "$repo='test';$git='test';$ssh='test';$expectedSurface=[Environment]::MachineName",
    "$env:COMPUTERNAME=$null;Check-LocalIdentity",
    "$env:COMPUTERNAME=$expectedSurface;Check-LocalIdentity",
    "$env:COMPUTERNAME='CONTRADICTORY-TEST-HOST';$denied=$false;try{Check-LocalIdentity}catch{if($_.Exception.Message -match 'must run on Surface'){$denied=$true}else{throw}};if(!$denied){throw 'CONTRADICTORY_ENV_ACCEPTED'}",
    "$expectedSurface='OTHER-TEST-HOST';$env:COMPUTERNAME=$expectedSurface;$denied=$false;try{Check-LocalIdentity}catch{if($_.Exception.Message -match 'must run on Surface'){$denied=$true}else{throw}};if(!$denied){throw 'ENV_SPOOFED_ACTUAL_HOST'}",
    "Write-Output 'ACTUAL_SURFACE_GUARD_PASS'",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ACTUAL_SURFACE_GUARD_PASS/);
});
