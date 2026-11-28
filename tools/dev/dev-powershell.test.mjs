import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dev.ps1");

test("manual remote control uses native SSH and the sandbox verifies its exact target", () => {
  assert.equal(existsSync(new URL("./Control-Lenovo-SSH.ps1", import.meta.url)), false);
  const sandbox = readFileSync(new URL("./start-operatorwebauthnsandbox.ps1", import.meta.url), "utf8");
  assert.match(sandbox, /System32\\OpenSSH\\ssh\.exe/);
  assert.match(sandbox, /BatchMode=yes.*StrictHostKeyChecking=yes/);
  assert.match(sandbox, /BTHWANI-DOCKER/);
  assert.match(sandbox, /OPERATOR_SANDBOX_LENOVO_NOT_VERIFIED/);
});
test("opening Chrome and Android is owned by the single dev launcher", () => {
  assert.equal(existsSync(new URL("./open-dev-apps.ps1", import.meta.url)), false);
});

test("native manifest and operator session use the direct readiness owner", () => {
  const opener = readFileSync(scriptPath, "utf8");
  assert.match(opener, /'Expo-Platform'='android'/);
  assert.match(opener, /\$manifest=Test-AppHttpTarget[^\r\n]*Kind='manifest'/);
  assert.match(opener, /\$state=Test-AppHttpTarget[^\r\n]*Kind='operator-session'/);
  assert.doesNotMatch(opener, /function Probe-App|Start-Sleep -Seconds 3/);
});

test("native manifest and unauthenticated session admit only matching documents, including cold start", {skip:process.platform!=="win32"}, async () => {
  const {createServer}=await import("node:http");
  const {spawn}=await import("node:child_process");
  const manifestHits=[];
  const authHits=[];
  const server=createServer((req,res)=>{
    const port=server.address().port;
    const valid={id:"dev-id",runtimeVersion:"0.3.1",launchAsset:{url:"http://127.0.0.1:"+port+"/apps/customer/index.bundle?platform=android",contentType:"application/javascript"},extra:{expoClient:{android:{package:"com.bthwani.customer"}}}};
    if(req.url==="/"){
      manifestHits.push([req.headers.accept,req.headers["expo-platform"]]);
      const cases=[
        [JSON.stringify(valid),8500],
        ["{}",0],
        [JSON.stringify({...valid,extra:{expoClient:{android:{package:"com.bthwani.merchant"}}}}),0],
        [JSON.stringify({...valid,launchAsset:{...valid.launchAsset,url:valid.launchAsset.url.replace("platform=android","platform=ios")}}),0],
        [JSON.stringify({...valid,launchAsset:{...valid.launchAsset,url:valid.launchAsset.url+"&platform=android"}}),0],
        [JSON.stringify({...valid,launchAsset:{...valid.launchAsset,url:valid.launchAsset.url.replace("127.0.0.1","localhost")}}),0],
        [JSON.stringify(valid).replace('"id":"dev-id"','"id":"other","id":"dev-id"'),0],
        ["{",0],
      ];
      const [body,delay]=cases[manifestHits.length-1];
      setTimeout(()=>{res.writeHead(200,{"Content-Type":"application/expo+json"});res.end(body);},delay);
    } else {
      authHits.push([req.headers.accept,req.headers.cookie,req.headers.authorization]);
      const cases=[
        [401,"application/json","private, no-store",'{"code":"UNAUTHORIZED"}'],
        [401,"text/html","no-store","unauthorized"],
        [401,"application/json","no-store",'{"code":"OTHER"}'],
        [401,"application/json","public",'{"code":"UNAUTHORIZED"}'],
        [503,"application/json","no-store",'{"code":"OWNER_UNAVAILABLE"}'],
        [503,"application/json","no-store",'{"code":"OTHER"}'],
        [200,"application/json","no-store",'{"code":"UNAUTHORIZED"}'],
      ];
      const [status,mime,cache,body]=cases[authHits.length-1];
      res.writeHead(status,{"Content-Type":mime,"Cache-Control":cache});res.end(body);
    }
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try {
    const quoted=scriptPath.replaceAll("'","''");
    const port=server.address().port;
    const ps=[
      "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest",
      "$tokens=$null;$errors=$null",
      "$ast=[Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$tokens,[ref]$errors)",
      "$n=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Test-AppHttpTarget'},$true);Invoke-Expression $n.Extent.Text",
      "$target=@{A='customer';Kind='manifest';Package='com.bthwani.customer';U='http://127.0.0.1:"+port+"/'}",
      "$r=Test-AppHttpTarget -Target $target -TimeoutSec 45;if(!$r.Success){throw ('NATIVE_MANIFEST_TIMEOUT '+$r.Error)}",
      "for($i=0;$i -lt 7;$i++){$r=Test-AppHttpTarget -Target $target;if($r.Success -or $r.Error -cne 'NATIVE_MANIFEST_MISMATCH'){throw ('WRONG_MANIFEST '+$i+' '+$r.Error)}}",
      "$target=@{A='control-panel';Kind='operator-session';U='http://localhost:"+port+"/api/auth/session'}",
      "$expected=@('','OPERATOR_AUTH_MISMATCH','OPERATOR_AUTH_MISMATCH','OPERATOR_AUTH_MISMATCH','OPERATOR_AUTH_UNAVAILABLE','OPERATOR_AUTH_MISMATCH','HTTP_200')",
      "foreach($e in $expected){$r=Test-AppHttpTarget -Target $target;if($r.Success -ne ($e -eq '') -or $r.Error -cne $e){throw ('WRONG_AUTH '+$e+' '+$r.Error)}}",
    ].join("; ");
    const result=await new Promise((resolve,reject)=>{
      const p=spawn("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{windowsHide:true,timeout:25000});
      let output="";p.stdout.on("data",v=>output+=v);p.stderr.on("data",v=>output+=v);
      p.once("error",reject);p.once("close",code=>resolve({code,output}));
    });
    assert.equal(result.code,0,result.output);
    assert.equal(manifestHits.length,8);
    assert.ok(manifestHits.every(([accept,platform])=>accept==="application/expo+json"&&platform==="android"));
    assert.equal(authHits.length,7);
    assert.ok(authHits.every(([accept,cookie,auth])=>accept==="application/json"&&!cookie&&!auth));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
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
  assert.doesNotMatch(fastPath[1], /Start-VerifiedEnvironment|Stop-Docker/);
  assert.match(launcher, /\{\$_ -in @\('up','warm'\)\}\s*\{[\s\S]*?Start-VerifiedEnvironment[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces[\s\S]*?break/);
  assert.match(launcher, /if\s*\(\$DockerAction -eq 'open'\)\s*\{Open-AppSurfaces;Show-OperatorAuthReadiness;return\}/);
  assert.match(launcher, /if\s*\(\$selection -eq 'All'\)/);
  assert.match(launcher, /'SAMSUNG' 'SKIPPED/);
});

test("native owner traffic reuses the verified SSH tunnel and cannot take over an arbitrary ADB port", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const tunnel = readFileSync(new URL("./Start-AppTunnel.ps1", import.meta.url), "utf8");
  const layout=JSON.parse(readFileSync(new URL("./ports.json",import.meta.url),"utf8"));
  assert.deepEqual(Object.values(layout.apps).map(a=>a.surface),[18101,18102,18103,13000]);
  assert.deepEqual(Object.values(layout.apps).map(a=>a.lenovo),[28111,28112,28113,23010]);
  assert.deepEqual(layout.ownerForwards,{identity:3201,dsh:3202});
  assert.match(tunnel,/ports\.json/);
  assert.match(tunnel,/foreach\(\$forward in \$expectedForwards\)/);
  assert.match(tunnel,/\$argsList \+= \$target/);
  assert.doesNotMatch(tunnel,/\$App\b|\.env\.tunnels\.local/);
  assert.equal((launcher.match(/Name=\x27BThwani Lenovo SSH Tunnel\x27/g)||[]).length,1);
  assert.match(launcher, /\$nativePorts = @\(\$android \| ForEach-Object/);
  assert.match(launcher, /Start-AppTunnel\.ps1'\) -VerifyOnly/);
  assert.match(launcher, /reverse' '--no-rebind'/);
  assert.match(launcher, /ADB_REVERSE_COLLISION/);
  assert.match(launcher, /\+ \$nativeOwnerPorts/);
});

test("tunnel listener state and recovery fail closed on foreign ownership", {skip:process.platform!=="win32"},()=>{
  const tunnelPath=path.join(path.dirname(scriptPath),"Start-AppTunnel.ps1").replaceAll("'","''");
  const ps=[
    "$ErrorActionPreference='Stop'",
    `$s=Get-Content -LiteralPath '${tunnelPath}' -Raw`,
    "$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'TUNNEL_PARSE'}",
    "foreach($name in @('Get-TunnelListenerState','Assert-TunnelAvailable')){$n=$ast.Find({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if(!$n){throw 'FUNCTION_MISSING'};Invoke-Expression $n.Extent.Text}",
    "$ssh='C:\\Windows\\System32\\OpenSSH\\ssh.exe';$target='bthwani-docker';$expectedForwards=@('127.0.0.1:18101:127.0.0.1:28111','127.0.0.1:3201:127.0.0.1:3201');$forwards=@(@{Local=18101},@{Local=3201});$VerifyOnly=$false;$argsList=@('-N','-T','-L',$expectedForwards[0],'-L',$expectedForwards[1],$target)",
    "$plan=@{Ssh=$ssh;Ports=@($forwards.Local);Arguments=$argsList};$canonical='\"'+$ssh+'\" '+($argsList -join ' ');$created=[datetime]'2026-01-01T01:00:00'",
    "function Get-NetTCPConnection {if($script:enumerationFailed){throw 'LISTENER_ENUMERATION_FAILED'};foreach($f in $script:fixturePorts){[pscustomobject]@{OwningProcess=100;LocalAddress='127.0.0.1';LocalPort=$f.Local}}}",
    "function Get-CimInstance {param($ClassName,$Filter);if($Filter -eq 'ProcessId=100'){[pscustomobject]@{ProcessId=100;ParentProcessId=200;ExecutablePath=$ssh;CommandLine=$script:command;CreationDate=$created}}elseif($Filter -eq 'ProcessId=200'){$script:parent}}",
    "function Stop-Process {param($Id);$script:stops++};function Write-TunnelLog {}",
    "$script:enumerationFailed=$false;$script:fixturePorts=$forwards;$script:command=$canonical;$script:parent=$null;if((Get-TunnelListenerState $plan).State -ne 'COMPLETE'){throw 'COMPLETE_FAILED'};$script:fixturePorts=@($forwards[0]);if((Get-TunnelListenerState $plan).State -ne 'PARTIAL'){throw 'PARTIAL_FAILED'};$script:fixturePorts=@();if((Get-TunnelListenerState $plan).State -ne 'EMPTY' -or (Assert-TunnelAvailable $plan)){throw 'EMPTY_FAILED'};$script:enumerationFailed=$true;$blocked=$false;try{Get-TunnelListenerState $plan}catch{$blocked=$true};if(!$blocked){throw 'ENUMERATION_FAILURE_ACCEPTED'};$script:enumerationFailed=$false;$script:fixturePorts=$forwards",
    "$cases=@(@{name='canonical orphan';command=$canonical;parent=$null;expected='STOP'},@{name='extra reverse';command=$canonical.Replace($target,'-R 127.0.0.1:29999:127.0.0.1:29999 '+$target);parent=$null;expected='BLOCK'},@{name='foreign destination';command=$canonical.Replace($target,'other-host '+$target);parent=$null;expected='BLOCK'},@{name='live foreign parent';command=$canonical;parent=[pscustomobject]@{Name='cmd.exe';CommandLine='cmd';CreationDate=$created.AddMinutes(-1)};expected='BLOCK'},@{name='active tunnel parent';command=$canonical;parent=[pscustomobject]@{Name='pwsh.exe';CommandLine='pwsh -File Start-AppTunnel.ps1';CreationDate=$created.AddMinutes(-1)};expected='BLOCK'})",
    "foreach($case in $cases){$script:stops=0;$script:command=$case.command;$script:parent=$case.parent;$blocked=$false;try{$null=Assert-TunnelAvailable $plan}catch{if($_.Exception.Message -notmatch '^APP_TUNNEL_'){throw};$blocked=$true};if($case.expected -eq 'STOP'){if($blocked -or $script:stops -ne 1){throw ('ORPHAN_NOT_RECOVERED '+$case.name)}}elseif(!$blocked -or $script:stops -ne 0){throw ('UNSAFE_STOP_ATTEMPT '+$case.name)}}",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const tunnel=readFileSync(new URL("./Start-AppTunnel.ps1",import.meta.url),"utf8");
  assert.match(tunnel,/while \(\$true\) \{\s*if \(Assert-TunnelAvailable \$plan\)/);
  assert.match(tunnel,/Mutex.*BThwani\.Lenovo\.AppTunnel/);
  assert.match(tunnel,/WaitOne\(0\)/);
  assert.doesNotMatch(tunnel,/2>>\s*\$logPath/);
});

test("Web and Metro readiness share endpoints and report bounded cold-start retries", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const targets = launcher.match(/function Get-AppHttpTargets \{([\s\S]*?)\n\}/);
  assert.ok(targets, "one endpoint inventory must serve both status and verification");
  for (const app of ["customer", "merchant", "captain", "'control-panel'"]) {
    assert.ok(targets[1].includes("$developmentPorts.apps."+app+".surface"));
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
    "function Invoke-WebRequest { param([switch]$UseBasicParsing,[switch]$SkipHttpErrorCheck,[string]$Uri,[int]$TimeoutSec,[int]$MaximumRedirection,[switch]$NoProxy) if($MaximumRedirection -ne 0 -or !$NoProxy){throw 'UNSAFE_HTTP_TRANSPORT'}; $script:tries++; if($script:alwaysFail -or $script:tries -eq 1){throw 'temporary failure'}; return [pscustomobject]@{StatusCode=200;Headers=@{'Content-Type'='text/html'};Content='<html>healthy</html>'} }",
    "$target=@{A='test';Kind='web';U='http://127.0.0.1:9/'}",
    "$script:tries=0;$script:alwaysFail=$false",
    "foreach($invalid in @('http://example.invalid:12345/','http://127.0.0.1/','http://user@127.0.0.1:9/','http://127.0.0.1:9/?q=1','http://127.0.0.1:9/#x','https://127.0.0.1:9/')){$rejected=$false;try{Test-AppHttpTarget -Target @{A='test';Kind='web';U=$invalid}|Out-Null}catch{$rejected=$_.Exception.Message -eq 'APP_PROBE_TARGET_INVALID'};if(!$rejected){throw 'INVALID_TARGET_ADMITTED'}}",
    "if($script:tries -ne 0){throw 'INVALID_TARGET_REACHED_TRANSPORT'}",
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
    "function Invoke-WebRequest { param([switch]$UseBasicParsing,[switch]$SkipHttpErrorCheck,[string]$Uri,[int]$TimeoutSec,[int]$MaximumRedirection,[switch]$NoProxy) if($MaximumRedirection -ne 0 -or !$NoProxy){throw 'UNSAFE_HTTP_TRANSPORT'}; return [pscustomobject]@{StatusCode=$script:status;Content=$script:body;Headers=@{'Content-Type'='text/html'}} }",
    "$target=@{A='customer';Kind='expo-web';U='http://127.0.0.1:9/'}",
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

test("app readiness rejects HTTP 200 with the wrong protocol payload", {skip:process.platform!=="win32"}, async () => {
  const {createServer}=await import("node:http");
  const {spawn}=await import("node:child_process");
  const hits=[];
  const server=createServer((req,res)=>{
    hits.push(req.url);
    const fixtures={
      "/metro": [200, {}, "packager-status:running"],
      "/wrong-metro": [200, {"Content-Type":"text/html"}, "<html>wrong service</html>"],
      "/suffix": [200, {}, "packager-status:running extra"],
      "/unavailable": [503, {}, "packager-status:running"],
      "/web": [200, {"Content-Type":"text/html; charset=utf-8"}, "<html>ready</html>"],
      "/redirect": [302, {"Location":"/web"}, ""],
      "/redirect-metro": [302, {"Location":"/metro"}, ""],
      "/duplicate-type": [200, {"Content-Type":["text/html","application/json"]}, "<html>wrong service</html>"],
      "/malformed-type": [200, {"Content-Type":"text/html;broken"}, "<html>wrong service</html>"],
      "/combined-type": [200, {"Content-Type":"text/html, application/json"}, "<html>wrong service</html>"],
      "/duplicate-param": [200, {"Content-Type":"text/html; charset=utf-8; Charset=ascii"}, "<html>wrong service</html>"],
      "/wrong-metro-type": [200, {"Content-Type":"text/html"}, "packager-status:running"],
      "/plain-metro": [200, {"Content-Type":"text/plain"}, "packager-status:running"],
      "/json": [200, {"Content-Type":"application/json"}, "{}"],
      "/empty": [200, {"Content-Type":"text/html"}, ""],
      "/ssr-error": [200, {"Content-Type":"text/html"}, "<html>Server Error: Requiring unknown module 60. unknownModuleError</html>"],
    };
    const [status,headers,body]=fixtures[req.url]??[404,{},""];
    res.writeHead(status,headers);res.end(body);
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try {
    const quoted=scriptPath.replaceAll("'","''");
    const ps=[
      "$ErrorActionPreference='Stop'",
      "$tokens=$null;$errors=$null",
      "$ast=[Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$tokens,[ref]$errors)",
      "foreach($name in @('Test-AppHttpTarget','Test-AppRestartHealth')){$n=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if(!$n){throw 'FUNCTION_MISSING'};Invoke-Expression $n.Extent.Text}",
      "$base='http://127.0.0.1:"+server.address().port+"'",
      "$cases=@(@{P='/metro';K='metro';A='captain';E=''},@{P='/wrong-metro';K='metro';A='customer';E='METRO_STATUS_MISMATCH'},@{P='/wrong-metro';K='metro';A='captain';E='METRO_STATUS_MISMATCH'},@{P='/suffix';K='metro';A='captain';E='METRO_STATUS_MISMATCH'},@{P='/unavailable';K='metro';A='captain';E='HTTP_503'},@{P='/web';K='web';A='control-panel';E=''},@{P='/redirect';K='web';A='control-panel';E='HTTP_REDIRECT'},@{P='/redirect-metro';K='metro';A='captain';E='HTTP_REDIRECT'},@{P='/duplicate-type';K='web';A='control-panel';E='WEB_DOCUMENT_MISMATCH'},@{P='/malformed-type';K='web';A='control-panel';E='WEB_DOCUMENT_MISMATCH'},@{P='/combined-type';K='web';A='control-panel';E='WEB_DOCUMENT_MISMATCH'},@{P='/duplicate-param';K='web';A='control-panel';E='WEB_DOCUMENT_MISMATCH'},@{P='/wrong-metro-type';K='metro';A='captain';E='METRO_STATUS_MISMATCH'},@{P='/plain-metro';K='metro';A='captain';E=''},@{P='/json';K='web';A='control-panel';E='WEB_DOCUMENT_MISMATCH'},@{P='/empty';K='expo-web';A='merchant';E='WEB_DOCUMENT_MISMATCH'},@{P='/ssr-error';K='expo-web';A='customer';E='EXPO_UNKNOWN_MODULE'})",
      "foreach($c in $cases){$target=@{A=$c.A;Kind=$c.K;U=$base+$c.P};$result=Test-AppHttpTarget -Target $target -MaxAttempts 1;if($result.Success -ne ($c.E -eq '') -or $result.Error -cne $c.E){throw ('WRONG_READINESS '+$c.P+' expected='+$c.E+' actual='+$result.Error+' success='+$result.Success)}}",
      "if(Test-AppRestartHealth @{A='captain';Kind='metro';U=$base+'/wrong-metro'}){throw 'FALSE_RESTART_HEALTH'}",
    ].join("; ");
    const result=await new Promise((resolve,reject)=>{
      const p=spawn("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{windowsHide:true,timeout:20000});
      let output="";p.stdout.on("data",v=>output+=v);p.stderr.on("data",v=>output+=v);
      p.once("error",reject);p.once("close",code=>resolve({code,output}));
    });
    assert.equal(result.code,0,result.output);
    assert.equal(hits.filter(url=>url==="/web").length,1,"redirect must never reach Web destination");
    assert.equal(hits.filter(url=>url==="/metro").length,1,"redirect must never reach Metro destination");
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test("browser, verify and restart use the same typed application readiness owner", () => {
  const launcher=readFileSync(scriptPath,"utf8");
  const browser=launcher.match(/function Open-Browser \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(browser);
  assert.match(browser,/A=\x27customer\x27;Kind=\x27metro\x27/);
  assert.match(browser,/A=\x27merchant\x27;Kind=\x27metro\x27/);
  assert.match(browser,/A=\x27control-panel\x27;Kind=\x27web\x27/);
  assert.match(browser,/Test-AppHttpTarget -Target \$target/);
  assert.doesNotMatch(browser,/\$statusUrls/);
  assert.match(launcher,/Kind=\$kind;U=/);
  assert.match(launcher,/Kind=\x27metro\x27;U="http:\/\/127\.0\.0\.1:\$\(\$developmentPorts\.apps\.captain\.surface\)\/status"/);
});

test("Docker status requires all three serving owners", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(launcher, /--include-wlt|optional WLT container/);
  assert.match(launcher, /function Show-Docker \{[\s\S]*?Assert-OwnerRuntime/);
  assert.match(launcher, /\[ValidateSet\('dsh','identity','wlt','postgres','media','mailpit','payment-mock'\)\]/);
  assert.match(launcher, /pnpm dev docker logs wlt/);
  assert.doesNotMatch(launcher, /WLT.*outside this Docker project/);
});

test("strict Docker verification and complete environment verification share the owner and Compose checks", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const owner = launcher.match(/function Assert-OwnerRuntime \{([\s\S]*?)\n\}/);
  assert.ok(owner);
  assert.match(owner[1], /verify-runtime-provenance\.mjs'\) '--context' \$dockerContext/);
  assert.match(owner[1], /Assert-Ok \(\$LASTEXITCODE -eq 0\)/);
  const config = launcher.match(/function Assert-CompleteCompose \{([\s\S]*?)\n\}/);
  assert.ok(config);
  for (const input of ["$baseCompose"]) {
    assert.ok(config[1].includes(input), "missing Compose input " + input);
  }
  assert.doesNotMatch(config[1], /'--profile'/);
  assert.match(config[1], /'config','--format','json'/);
  assert.match(config[1], /unprovisioned owner Compose input/);
  assert.doesNotMatch(config[1], /compose\.(?:dsh|identity|wlt|merchant|captain)\.yaml/);
  assert.doesNotMatch(config[1], /'up'|'run'|'bootstrap'/);
  const scoped = launcher.match(/function Invoke-ScopedDocker \{([\s\S]*?)\n\}/);
  assert.ok(scoped);
  assert.match(scoped[1], /'config' \{ Assert-CompleteCompose \}/);
  assert.match(scoped[1], /'verify' \{ Assert-OwnerRuntime \}/);
  const main = launcher.slice(launcher.indexOf("switch ($Action.ToLowerInvariant())"));
  for (const action of ["launch", "verify"]) {
    const branch = main.match(new RegExp("'" + action + "'\\s*\\{([\\s\\S]*?)\\n\\s*break"));
    assert.ok(branch);
    assert.match(branch[1], /Assert-EnvironmentReady/);
  }
  assert.match(main, /\{\$_ -in @\(\x27up\x27,\x27warm\x27\)\}\s*\{[\s\S]*?Assert-EnvironmentReady[\s\S]*?break/);
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
test("development resource admission separates readers and actual writers", {skip:process.platform!=="win32"}, () => {
  const helper = path.join(path.dirname(scriptPath), "dev-resource-admission.ps1").replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    ". '"+helper+"'",
    "$d='Global\\BThwaniDevDockerV1';$a='Global\\BThwaniDevAppsV1';$b='Global\\BThwaniDevBrowserV1';$m='Global\\BThwaniDevAndroidV1'",
    "$rows=@(@('Docker','reconcile',$false,'','All',''),@('Docker','reconcile',$true,'','All',$d),@('Docker','reconcile',$false,('a'*64),'All',$d),@('Docker','build',$false,'','All',$d),@('Apps','reconcile',$false,'','All',''),@('Apps','reconcile',$true,'','All',$a),@('Apps','restart',$false,'','All',''),@('Apps','start',$false,'','All',''),@('Apps','restart',$true,'','All',$a),@('Apps','start',$true,'','All',$a),@('Apps','open',$false,'','Browser',$b),@('Apps','open',$false,'','Android',$m),@('Apps','open',$false,'','All',($b+','+$m)),@('Apps','recover',$false,'','All',$m),@('Apps','android',$false,'','All',''),@('Status','help',$false,'','All',''),@('Verify','help',$false,'','All',''),@('Migrations','help',$false,'','All',''),@('Launch','help',$false,'','All',($a+','+$b+','+$m)),@('Launch','help',$false,'','Browser',($a+','+$b)),@('Up','help',$false,'','All',($d+','+$a+','+$b+','+$m)),@('Warm','help',$false,'','All',($d+','+$a+','+$b+','+$m)),@('Down','help',$false,'','All',($d+','+$a+','+$b+','+$m)),@('Docker','ps',$false,'','All',''),@('Docker','status',$false,'','All',''),@('Docker','logs',$false,'','All',''),@('Docker','verify',$false,'','All',''),@('Docker','config',$false,'','All',''),@('ProvisionWlt','help',$false,'','All',$d))",
    "foreach($r in $rows){$actual=@(Get-DevOperationResources $r[0] $r[1] $r[2] $r[3] $r[4]) -join ',';if($actual -cne $r[5]){throw ('RESOURCE_MATRIX_FAIL '+($r -join '|')+' actual='+$actual)}}",
    "$prefix='Global\\BThwaniFixture-'+[guid]::NewGuid().ToString('N');$one=$prefix+'-one';$two=$prefix+'-two'",
    "$childPrefix='. ''"+helper+"'';$ErrorActionPreference=''Stop'';'",
    "$locks=@(Enter-DevResources @($two));try{$body=$childPrefix+'$rejected=$false;try{$bad=@(Enter-DevResources @('''+$one+''','''+$two+'''));Exit-DevResources $bad}catch{$rejected=$_.Exception.Message -match ''DEV_RESOURCE_BUSY''};if(!$rejected){throw ''CONFLICT_ADMITTED''};$good=@(Enter-DevResources @('''+$one+'''));Exit-DevResources $good;''INDEPENDENT_PASS''';$result=& pwsh.exe -NoProfile -NonInteractive -Command $body;if($LASTEXITCODE -or $result -ne 'INDEPENDENT_PASS'){throw 'CROSS_PROCESS_FAIL'}}finally{Exit-DevResources $locks}",
    "$locks=@(Enter-DevResources @($one,$two));Exit-DevResources $locks",
    "$keep=[Threading.Mutex]::new($false,$one);try{$body=$childPrefix+'$lock=[Threading.Mutex]::new($false,'''+$one+''');if(!$lock.WaitOne(0)){throw ''FIXTURE_BUSY''};exit 0';& pwsh.exe -NoProfile -NonInteractive -Command $body;if($LASTEXITCODE){throw 'ABANDONMENT_FIXTURE_FAILED'};$rejected=$false;try{$bad=@(Enter-DevResources @($one));Exit-DevResources $bad}catch{$rejected=$_.Exception.Message -match 'DEV_RESOURCE_RECOVERY_REQUIRED'};if(!$rejected){throw 'ABANDONED_RESOURCE_ADMITTED'}}finally{$keep.Dispose()}",
    "Write-Output 'RESOURCE_ADMISSION_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",script],{encoding:"utf8",timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/RESOURCE_ADMISSION_PASS/);
});

test("launcher and WLT use the sole resource admission owner", () => {
  const launcher=readFileSync(scriptPath,"utf8");
  const wlt=readFileSync(new URL("./provision-wlt-test-db.ps1",import.meta.url),"utf8");
  for(const source of [launcher,wlt]){
    assert.match(source,/dev-resource-admission\.ps1/);
    assert.match(source,/Enter-DevResources/);
    assert.match(source,/Exit-DevResources/);
    assert.doesNotMatch(source,/BThwaniUnifiedDevV1|BThwaniAndroidReverseV1|readOnlyOperation/);
  }
  assert.match(wlt,/Get-DevOperationResources 'ProvisionWlt'/);
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
    ". (Join-Path (Get-Location).Path 'tools/dev/task-ownership.ps1')",
    "$root='C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime';$node='C:\\Users\\bthwa\\BThwaniAppRunner\\tools\\node-v24.22.1-refoundation\\node.exe'",
    "$now=[datetime]'2026-11-24T00:00:00Z'",
    "function P($id,$parent,$name,$exe,$cmd,$seconds){[pscustomobject]@{ProcessId=$id;ParentProcessId=$parent;Name=$name;ExecutablePath=$exe;CommandLine=$cmd;CreationDate=$now.AddSeconds($seconds)}}",
    "$specs=@(@{A='control-panel';N='BThwani Control Next Native'})",
    "$exe='C:\\Program Files\\PowerShell\\7\\pwsh.exe';$arg='-NoProfile -NonInteractive -WindowStyle Hidden -File '+[char]34+$root+'\\tools\\dev\\Start-App.ps1'+[char]34+' -App control-panel'",
    "function Get-ScheduledTask {param($TaskPath,$TaskName,$ErrorAction) [pscustomobject]@{TaskName=$TaskName;TaskPath=$TaskPath;Actions=@([pscustomobject]@{Execute=$exe;Arguments=$arg;WorkingDirectory=''})}}",
    "$launcher=P 10 1 'pwsh.exe' $exe ([char]34+$exe+[char]34+' '+$arg) 0",
    "$parent=P 20 10 'node.exe' $node 'next dev' 1",
    "$child=P 30 20 'node.exe' $node 'next child' 2",
    "$other=P 40 1 'node.exe' $node 'unrelated' 1",
    "$console=P 45 10 'conhost.exe' (Join-Path $env:WINDIR 'System32\\conhost.exe') 'console' 1",
    "$tree=@(Get-OwnedAppProcessTree 'control-panel' @($launcher,$parent,$child,$other,$console) $root $node)",
    "if(($tree.ProcessId -join ',') -ne '10,20,30'){throw 'OWNED_DESCENDANTS_WRONG'}",
    "$reuse=P 30 20 'node.exe' $node 'next child' 4",
    "if(Test-SameOwnedAppProcess $child $reuse){throw 'REUSED_PID_ACCEPTED'}",
    "if(!(Test-SameOwnedAppProcess $child $child)){throw 'SAME_PID_REJECTED'}",
    "$impostor=P 11 1 'pwsh.exe' $exe ([char]34+$exe+[char]34+' -Command echo '+$arg) 0",
    "$denied=$false;try{Get-OwnedAppProcessTree 'control-panel' @($impostor,$parent) $root $node|Out-Null}catch{$denied=$_.Exception.Message -match 'APP_TREE_LAUNCHER_UNPROVEN'};if(!$denied){throw 'IMPOSTOR_LAUNCHER_ADMITTED'}",
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

test("the launcher consumes canonical Customer and Merchant Windows task identities", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const layout=JSON.parse(readFileSync(new URL("./ports.json",import.meta.url),"utf8"));
  assert.equal(layout.apps.customer.task,"BThwani Customer Metro Native");
  assert.equal(layout.apps.merchant.task,"BThwani Merchant Metro Native");
  assert.match(launcher,/N=\$entry\.Value\.task/);
  assert.match(launcher,/\$script=\$remoteAppSpecs/);
  assert.match(launcher,/Invoke-Lenovo \(\$remoteAppSpecs/);
  assert.doesNotMatch(launcher, /BThwani (?:Client|Partner|Customer|Merchant) Metro Native/);
  assert.ok(Object.values(layout.apps).every(a=>!(/\b(?:Client|Partner)\b/.test(a.task))));
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
    "$RecoverRuntimeAttempt=$null;$PrepareBaseline=$true;$mode='--apply-preview'",
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

test("automatic recovery forwards only the proven safe-boundary mode and exact attempt key", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'","''");
  const ps = [
    "$ErrorActionPreference='Stop';$tok=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('"+quoted+"',[ref]$tok,[ref]$errors)",
    "if($errors){throw 'PARSE_FAILED'}",
    "$modeAssignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$mode' -and $n.Extent.Text.Contains('--recover-safe')},$true)",
    "$optionsAssignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$reconcileOptions'},$true)",
    "if(!$modeAssignment -or !$optionsAssignment){throw 'RECOVERY_DISPATCH_MISSING'}",
    "$RecoverRuntimeAttempt='a'*64;$Apply=$false;$EnableCaptain=$false;$Preview=$false;$PrepareBaseline=$false;$ConfigurationFrom=$null",
    "foreach($Automatic in @($true,$false)){Invoke-Expression $modeAssignment.Extent.Text;Invoke-Expression $optionsAssignment.Extent.Text;& node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- $mode @reconcileOptions;if($LASTEXITCODE){throw 'PROBE_FAILED'}}",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line)),[["--recover-safe","a".repeat(64)],["--recover-attempt","a".repeat(64)]]);
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
  assert.match(watch,/if\(dependencyChild\)return;/);
  assert.match(watch,/if \(runtimeChild \|\| !fs\.existsSync\(runtimeOptIn\)\) return;/);
  assert.match(watch,/busy:Boolean\(runtimeChild\|\|dependencyChild\|\|graphChild\)/);
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

test("scoped restart reuses the canonical Expo probe and requires consecutive healthy renders", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$err=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$err)`,
    "foreach($name in @('Assert-Ok','Test-AppHttpTarget','Test-AppRestartHealth','Control-SingleApp')){$n=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if($n){Invoke-Expression $n.Extent.Text}}",
    "function Invoke-Lenovo([string]$body){$script:payload=$body}",
    "$App='merchant';$Apply=$true;$repo=(Get-Location).Path;$remoteAppProcessLifecycle=''",
    "Control-SingleApp 'restart'",
    "$tok=$null;$err=$null;$remote=[Management.Automation.Language.Parser]::ParseInput($script:payload,[ref]$tok,[ref]$err);if($err.Count){throw 'REMOTE_PARSE_FAILED'}",
    "foreach($name in @('Test-AppHttpTarget','Test-AppRestartHealth')){$n=$remote.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if(!$n){throw ('REMOTE_PROBE_MISSING '+$name)};Invoke-Expression $n.Extent.Text}",
    "if($script:payload -notmatch 'if\\(Test-AppRestartHealth.*APP_RESTART_SKIPPED_HEALTHY'){throw 'REMOTE_SKIP_NOT_GUARDED'}",
    "function Start-Sleep {}",
    "function Invoke-WebRequest {param([switch]$UseBasicParsing,[switch]$SkipHttpErrorCheck,[string]$Uri,[int]$TimeoutSec,[int]$MaximumRedirection,[switch]$NoProxy) if($MaximumRedirection -ne 0 -or !$NoProxy){throw 'UNSAFE_HTTP_TRANSPORT'}; $script:count++;return $script:responses[[Math]::Min($script:count-1,$script:responses.Count-1)]}",
    "$good=@{StatusCode=200;Content='<html>healthy</html>';Headers=@{'Content-Type'='text/html'}};$bad=@{StatusCode=200;Content='<html>Server Error: Requiring unknown module 60. unknownModuleError</html>'};$failed=@{StatusCode=500;Content='Server Error'}",
    "foreach($app in @('customer','merchant')){$target=@{A=$app;Kind='expo-web';U='http://127.0.0.1:9/'};foreach($case in @(@{responses=@($good,$good,$good);expected=$true;count=3},@{responses=@($bad);expected=$false;count=1},@{responses=@($good,$bad);expected=$false;count=2},@{responses=@($good,$good,$failed);expected=$false;count=3})){$script:responses=$case.responses;$script:count=0;$actual=Test-AppRestartHealth $target;if($actual -ne $case.expected -or $script:count -ne $case.count){throw ('FALSE_RESTART_HEALTH '+$app)}}}",
    "$script:responses=@(@{StatusCode=200;Content=[Text.Encoding]::UTF8.GetBytes('packager-status:running');Headers=@{}});$script:count=0;if(!(Test-AppRestartHealth @{A='captain';Kind='metro';U='http://127.0.0.1:9/status'}) -or $script:count -ne 1){throw 'METRO_PROBE_CHANGED'}",
    "Write-Output 'RESTART_HEALTH_PROOF_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/RESTART_HEALTH_PROOF_PASS/);
});

test("normal startup starts only seven already provisioned services through native Compose", () => {
  const launcher=readFileSync(scriptPath,"utf8");
  const start=launcher.match(/function Start-VerifiedEnvironment \{([\s\S]*?)\n\}/);
  assert.ok(start);
  assert.match(start[1],/--start-preflight[\s\S]*?missing existing Compose service[\s\S]*?\x27start\x27,\x27--wait\x27,\x27--wait-timeout\x27,\x2760\x27[\s\S]*?Assert-OwnerRuntime/);
  assert.match(start[1],/\$services=@\(\x27postgres\x27,\x27media\x27,\x27mailpit\x27,\x27payment-mock\x27,\x27identity\x27,\x27dsh\x27,\x27wlt\x27\)/);
  assert.doesNotMatch(start[1],/\x27(?:up|run|build|bootstrap)\x27/);
});

test("canonical application task layout is identical in PowerShell 7 and Windows PowerShell 5.1", {skip:process.platform!=="win32"},()=>{
  const source=readFileSync(scriptPath,"utf8");
  const block=source.match(/\$remoteSpecs = @\(foreach[\s\S]*?\n\$remoteAppSpecs = [^\n]+/);
  assert.ok(block);
  const layoutPath=path.join(path.dirname(scriptPath),"ports.json").replaceAll("\x27","\x27\x27");
  const command=["$ErrorActionPreference=\x27Stop\x27","[ValidateSet(\x27customer\x27,\x27merchant\x27,\x27captain\x27,\x27control-panel\x27)][string]$App=\x27customer\x27","$developmentPorts=Get-Content -LiteralPath \x27"+layoutPath+"\x27 -Raw|ConvertFrom-Json",block[0],"if($App -cne \x27customer\x27){throw \x27APP_PARAMETER_MUTATED\x27}","$specs=@(); . ([scriptblock]::Create($remoteAppSpecs))", "ConvertTo-Json -InputObject @($specs) -Compress"].join("; ");
  for(const shell of ["pwsh.exe","powershell.exe"]){
    const result=spawnSync(shell,["-NoProfile","-NonInteractive","-Command",command],{encoding:"utf8",windowsHide:true,timeout:15000});
    assert.equal(result.status,0,shell+": "+(result.stderr||result.stdout));
    const records=JSON.parse(result.stdout.trim());
    assert.deepEqual(records.map(r=>r.A),["customer","merchant","captain","control-panel"]);
    assert.deepEqual(records.map(r=>r.P),[28111,28112,28113,23010]);
  }
});

test("ADB mapping state rejects missing, conflicting and duplicate reverse bindings", {skip:process.platform!=="win32"},()=>{
  const source=scriptPath.replaceAll("'","''");
  const ps=[
    "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest",
    "$s=Get-Content -LiteralPath '"+source+"' -Raw",
    "$a=$s.IndexOf('function Get-AndroidMappingState(');$b=$s.IndexOf('function Get-AndroidReverseState',$a);. ([scriptblock]::Create($s.Substring($a,$b-$a)))",
    "$m=@(Get-AndroidMappingState -Lines @('UsbFfs tcp:18101 tcp:18101','UsbFfs tcp:3201 tcp:9000','UsbFfs tcp:3202 tcp:3202','UsbFfs tcp:3202 tcp:3202','UsbFfs tcp:9999 tcp:18102') -Ports @(18101,18102,3201,3202))",
    "if(!$m[0].Configured -or $m[1].Configured -or $m[1].Collision -or !$m[2].Collision -or !$m[3].Collision){throw 'BAD_MAPPING_CLASSIFICATION'}"
  ].join("; ");
  const run=spawnSync("pwsh.exe",["-NoProfile","-Command",ps],{encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
});
test("canonical task ownership rejects unrelated executable, extra actions, foreign paths and unknown switches", {skip:process.platform!=="win32"},()=>{
  const ps=[
    "$ErrorActionPreference='Stop'",
    ". (Join-Path (Get-Location).Path 'tools/dev/task-ownership.ps1')",
    "$spec=@{A='merchant';N='BThwani Merchant Metro Native'}",
    "$exe='C:\\Program Files\\PowerShell\\7\\pwsh.exe';$arg='-NoProfile -NonInteractive -WindowStyle Hidden -File '+[char]34+'C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime\\tools\\dev\\Start-App.ps1'+[char]34+' -App merchant'",
    "function Get-ScheduledTask {param($TaskPath,$TaskName,$ErrorAction) $script:fixture}",
    "function Action($e,$a){[pscustomobject]@{Execute=$e;Arguments=$a;WorkingDirectory=''}}",
    "function Task($actions,$path='\\'){[pscustomobject]@{TaskName=$spec.N;TaskPath=$path;Actions=@($actions)}}",
    "$script:fixture=Task (Action $exe $arg);$null=Get-VerifiedAppTask $spec",
    "$bad=@((Task (Action 'C:\\Windows\\System32\\cmd.exe' $arg)),(Task @((Action $exe $arg),(Action $exe $arg))),(Task (Action $exe ($arg.Replace('source-runtime','foreign-runtime')))),(Task (Action $exe ($arg+' -Unknown'))),(Task (Action $exe $arg) '\\foreign\\'))",
    "foreach($script:fixture in $bad){$denied=$false;try{$null=Get-VerifiedAppTask $spec}catch{$denied=$_.Exception.Message -match 'TASK_OWNER_CHANGED'};if(!$denied){throw 'FOREIGN_TASK_ADMITTED'}}",
    "Write-Output 'EXACT_TASK_ADMISSION_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/EXACT_TASK_ADMISSION_PASS/);
});
test("exact task argument grammar admits only fixed tokens and app-specific explicit switches", {skip:process.platform!=="win32"},()=>{
  const ps=[
    "$ErrorActionPreference='Stop'",
    ". (Join-Path (Get-Location).Path 'tools/dev/task-ownership.ps1')",
    "$exe='C:\\Program Files\\PowerShell\\7\\pwsh.exe';$base='-NoProfile -NonInteractive -WindowStyle Hidden -File '+[char]34+'C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime\\tools\\dev\\Start-App.ps1'+[char]34+' -App '",
    "function Get-ScheduledTask {param($TaskPath,$TaskName,$ErrorAction) [pscustomobject]@{TaskName=$TaskName;TaskPath=$TaskPath;Actions=@([pscustomobject]@{Execute=$exe;Arguments=$script:arguments;WorkingDirectory=''})}}",
    "function Verify($app,$suffix,$expected){$script:arguments=$base+$app+$suffix;$accepted=$true;try{$null=Get-VerifiedAppTask @{A=$app;N='fixture'}}catch{$accepted=$false};if($accepted -ne $expected){throw ('ARGUMENT_GRAMMAR_MISMATCH '+$app+' suffixLength='+$suffix.Length)}}",
    "Verify 'merchant' '' $true;Verify 'captain' '' $true",
    "Verify 'merchant' ([string][char]10) $false;Verify 'merchant' ([string][char]13) $false;Verify 'merchant' ' ' $false;Verify 'merchant' ' -EnableDockerWalletWebPreview' $false",
    "Verify 'customer' ' -EnableDockerWalletWebPreview -EnableDockerCustomerAndroidIdentityPreview' $true;Verify 'customer' ' -EnableDockerWalletWebPreview -EnableDockerWalletWebPreview' $false;Verify 'customer' '  -EnableDockerWalletWebPreview' $false;Verify 'customer' (' -EnableDockerWalletWebPreview'+[char]10) $false;Verify 'customer' ' -enableDockerWalletWebPreview' $false",
    "Verify 'control-panel' ' -EnableIsolatedOperatorPasskeyPreview -EnableIsolatedRootBootstrap' $true;Verify 'control-panel' ' -EnableIsolatedRootBootstrap' $false;Verify 'control-panel' ' -UseDisposableOperatorSandbox' $false",
    "$task=[pscustomobject]@{TaskName='surface';TaskPath='\\';Actions=@([pscustomobject]@{Execute='C:\\Program Files\\nodejs\\node.exe';Arguments='canonical';WorkingDirectory='D:\\samrim'})};$null=Assert-CanonicalTask $task 'surface' 'C:\\Program Files\\nodejs\\node.exe' 'canonical' 'D:\\samrim'",
    "$task.Actions[0].Arguments+=' '+[char]10;$refused=$false;try{$null=Assert-CanonicalTask $task 'surface' 'C:\\Program Files\\nodejs\\node.exe' 'canonical' 'D:\\samrim'}catch{$refused=$true};if(!$refused){throw 'SURFACE_TRAILING_INPUT_ADMITTED'}",
    "Write-Output 'TASK_TOKEN_GRAMMAR_PASS'",
  ].join("; ");
  const result=spawnSync("pwsh.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/TASK_TOKEN_GRAMMAR_PASS/);
});
test("development registration seed requires explicit application and uses the existing Docker resource", { skip: process.platform !== "win32" }, () => {
  const helper = path.join(path.dirname(scriptPath), "dev-resource-admission.ps1").replaceAll("'", "''");
  const launcher = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    ". '"+helper+"'",
    "$d='Global\\BThwaniDevDockerV1'",
    "if(@(Get-DevOperationResources 'Docker' 'seed' $false).Count){throw 'READ_ONLY_SEED_TAKES_WRITE_LEASE'}",
    "if((@(Get-DevOperationResources 'Docker' 'seed' $true) -join ',') -cne $d){throw 'SEED_WRITE_LEASE_MISSING'}",
    "$tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('"+launcher+"',[ref]$tokens,[ref]$errors)",
    "if($errors.Count){throw 'LAUNCHER_PARSE'}",
    "foreach($name in @('Assert-Ok','Invoke-DevelopmentRegistrationSeed')){$n=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true);if(!$n){throw ('MISSING_FUNCTION '+$name)};Invoke-Expression $n.Extent.Text}",
    "$repo='D:\\samrim';$dockerContext='bthwani-docker';$DockerService='dsh';$Apply=$false;$Automatic=$false;$Preview=$false;$EnableCaptain=$false;$PrepareBaseline=$false;$RecoverRuntimeAttempt='';$ConfigurationFrom='';$DeepSql=$false",
    "$script:target='a'*64;$script:nodeExit=0;$script:invocations=@();$script:dbProof='DSH_DEVELOPMENT_DATABASE_PASS'",
    "function Say($key,$value){}",
    "function node { $script:LASTEXITCODE=$script:nodeExit; $script:target }",
    "function Invoke-DockerCli([string[]]$argsList){$script:invocations+=,($argsList -join ' ');if($argsList[-1] -eq 'verify-development-db'){$script:dbProof}else{'DSH_ISOLATED_OWNER_IMPORT_PASS schema=dsh_test_retained'}}",
    "Invoke-DevelopmentRegistrationSeed;if($script:invocations.Count -ne 1 -or $script:invocations[0] -cne ('exec '+$script:target+' /usr/local/bin/dsh -mode verify-development-db')){throw 'DRY_RUN_MUTATION'}",
    "$Apply=$true;$script:invocations=@();Invoke-DevelopmentRegistrationSeed;if($script:invocations.Count -ne 2 -or $script:invocations[1] -cne ('exec '+$script:target+' /usr/local/bin/dsh -mode isolated-seed -seed-profile development-registration')){throw 'WRONG_OWNER_SEED_COMMAND'}",
    "foreach($case in @('wrong-owner','automatic','invalid-target','failed-attestation','failed-db')){$DockerService='dsh';$Automatic=$false;$script:target='a'*64;$script:nodeExit=0;$script:dbProof='DSH_DEVELOPMENT_DATABASE_PASS';switch($case){'wrong-owner'{$DockerService='wlt'}'automatic'{$Automatic=$true}'invalid-target'{$script:target='foreign'}'failed-attestation'{$script:nodeExit=1}'failed-db'{$script:dbProof='invalid'}};$script:invocations=@();$denied=$false;try{Invoke-DevelopmentRegistrationSeed}catch{$denied=$true};if(!$denied -or @($script:invocations|Where-Object {$_ -match 'isolated-seed'}).Count){throw ('UNSAFE_SEED_ADMITTED '+$case)}}",
    "Write-Output 'SEED_ADMISSION_PASS'",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SEED_ADMISSION_PASS/);
  const source = readFileSync(scriptPath, "utf8");
  assert.match(source, /'seed'\s*\{\s*Invoke-DevelopmentRegistrationSeed\s*\}/);
});
