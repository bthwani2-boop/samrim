import { resolveTrustedExecutable } from "./runtime-proof/trusted-executables.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const compareStrings=(left,right)=>String(left).localeCompare(String(right),"en");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const pkg=JSON.parse(read("package.json"));
const dev=read("tools/dev/dev.ps1");
const scr=read("tools/dev/scr.ps1");
const launcher=read("tools/dev/start-surface.mjs");
const mobilePrepare=read("tools/mobile/prepare-local-development.ps1");
const mobileBuild=read("tools/mobile/build-development.ps1");
const liveRunner=read("tools/dev/run-playwright-live.mjs");
const identityRuntimeProof=read("tools/dev/verify-identity-runtime.mjs");
const dshRuntimeProof=read("tools/dev/verify-dsh-runtime-core.mjs");
const dshLocationRuntimeProof=read("tools/dev/verify-dsh-location-runtime.mjs");
const hostCleanup=dev.slice(dev.indexOf("function Stop-RepositoryHosts {"),dev.indexOf("\nswitch ($Target)"));
const dshProject=JSON.parse(read("services/dsh/backend/project.json"));
const ciRuntimeRunner=read("tools/dev/run-ci-runtime-proof.mjs");
const liveIdentitySpec=read("apps/control-panel/tests/00-live-identity.spec.ts");
const liveIdentityHelpers=read("apps/control-panel/tests/live-identity-proof-helpers.ts");
const liveFinanceSpec=read("apps/control-panel/tests/finance-runtime.spec.ts");
const liveDshOperatorSpec=read("apps/control-panel/tests/zz-dsh-operator.spec.ts");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};
const cleanupPatternSources=[...hostCleanup.matchAll(/^\s*"\(\?i\)([^"]+)"[,]?$/gm)].map((match)=>match[1]);
const regexMetaCharacters=new Set([".","*","+","?","^","$","{","}","(",")","|","[","]",String.fromCharCode(92)]);
const escapedAppsRoot=[...path.join(root,"apps")].map((character)=>regexMetaCharacters.has(character)?String.fromCharCode(92)+character:character).join("");
const ownedSurfaceMatches=(command)=>cleanupPatternSources.some((source)=>new RegExp(source.replace("$appsRoot",escapedAppsRoot),"i").test(command));

const ps=spawnSync(resolveTrustedExecutable("pwsh"),["-NoProfile","-Command",
  "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"
],{cwd:root,encoding:"utf8"});
check(ps.status===0,"dev.ps1 PowerShell syntax must parse cleanly");
const psScr=spawnSync(resolveTrustedExecutable("pwsh"),["-NoProfile","-Command","$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/scr.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"],{cwd:root,encoding:"utf8"});
check(psScr.status===0,"scr.ps1 PowerShell syntax must parse cleanly");
for(const script of ["tools/dev/start-surface.mjs","tools/dev/run-playwright-live.mjs","tools/dev/verify-identity-runtime.mjs"]){
  check(spawnSync(process.execPath,["--check",script],{cwd:root}).status===0,`${script} syntax must parse cleanly`);
}

const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
for(const [name,target] of Object.entries({dev:"daily","runtime:up":"up","runtime:down":"down","runtime:status":"status"})){
  check(pkg.scripts?.[name]===`${run} ${target}`,`${name} must route to infra/device owner`);
}
check(pkg.scripts?.scr==="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/scr.ps1","scr must route directly to the dedicated device owner");
for(const [name,dir] of Object.entries({client:"app-client",partner:"app-partner",captain:"app-captain",field:"app-field",control:"control-panel"})){
  check(pkg.scripts?.[name]===`pnpm --dir apps/${dir} dev`,`${name} must route through its owning app package`);
  const surfacePkg=JSON.parse(read(`apps/${dir}/package.json`));
  check(surfacePkg.scripts?.dev==="node ../../tools/dev/start-surface.mjs",`${name} package must own direct dev startup`);
}
check(launcher.includes("const surfaceRoot=requestedSurface?path.join(appsRoot,requestedSurface):process.cwd()"),"root surface launch must resolve the selected app to its own package directory");
check(launcher.includes("supportedSurfaces.has(requestedSurface)"),"surface launcher must validate explicit app identities before resolving a path");
check(!Object.keys(pkg.scripts??{}).some((name)=>name.startsWith("world:")),"persistent synthetic world commands must remain absent");
check(pkg.scripts?.["runtime:verify-ownership"]===undefined,"runtime ownership verifier must remain internal to candidate verification");
check(pkg.scripts?.["runtime:reset"]===undefined&&pkg.scripts?.["runtime:purge"]===undefined,"unproven destructive runtime command aliases must remain absent");
for(const retired of ["tools/dev/local-world.mjs","tools/dev/verify-local-world.mjs","tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/run-control.ps1","tools/dev/open-mobile-apps.ps1","tools/dev/scrcpy.ps1"]){
  check(!fs.existsSync(path.join(root,retired)),`retired local development artifact remains: ${retired}`);
}
for(const removed of ["Start-MobileServer","Start-ControlServer","Stop-OwnedListener","Get-OwnedNodeTreeRoot","Wait-Servers","Ensure-HostServers","Ensure-OneMobile","Ensure-ControlOnly"]){
  check(!dev.includes(removed),`dev.ps1 retains surface runtime ownership: ${removed}`);
}
check(!dev.includes("--dev-client"),"dev.ps1 must not launch Expo");
check(!dev.includes(String.raw`dist\bin\next`),"dev.ps1 must not launch Next");
check(dev.includes("Read-BackendServiceStates"),"dev.ps1 must read canonical Compose service state");
check(!dev.includes("Read-RunningBackendServices"),"dev.ps1 must not duplicate Compose state reads on the warm path");
check(dev.includes("BACKEND_REUSE=PASS state=healthy inputs=unchanged images=verified"),"healthy unchanged runtime must have a no-build reuse path");
check(dev.includes("Read-RunningBackendImages"),"runtime reuse must prove running backend image provenance");
check(dev.includes("Test-BackendImageStateEqual"),"runtime reuse must reject stale container image provenance");
check(/schema\s*= 3/.test(dev)&&/\$state\['schema'\] -ne 3/.test(dev)&&/compose\s*= \(Get-FileSha256 \$ComposePath\)/.test(dev)&&/env\s*= \(Get-FileSha256 \$EnvPath\)/.test(dev),"runtime state must distinguish Compose topology from runtime environment changes");
check(dev.includes("$composeChanged")&&dev.includes("$composeChanged -or"),"Compose topology changes must force backend image reconciliation");
check(dev.includes("Test-RuntimeBuildPath")&&dev.includes("git -C $Root ls-files -s"),"runtime fingerprint must use Git index material for backend image invalidation");
check(dev.includes("Get-WorkingTreeMaterialRecords")&&dev.includes("git -C $Root diff --name-only HEAD"),"runtime fingerprint must overlay only changed working-tree runtime material");
const buildPathProbe=spawnSync(resolveTrustedExecutable("pwsh"),["-NoProfile","-Command",[
  "$errors=$null;$tokens=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$tokens,[ref]$errors)",
  "if($errors.Count){exit 2}",
  "$function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-RuntimeBuildPath'},$true)",
  "if(-not $function){exit 3}",
  "Invoke-Expression $function.Extent.Text",
  "$cases=@(@('services/dsh/backend/internal/x.go',$true),@('services/dsh/backend/internal/x_test.go',$false),@('services/dsh/backend/Dockerfile',$true),@('services/dsh/backend/schema.sql',$true),@('services/dsh/backend/readme.md',$false))",
  "foreach($case in $cases){if((Test-RuntimeBuildPath $case[0]) -ne $case[1]){exit 1}}"
].join(";")],{cwd:root,encoding:"utf8"});
check(buildPathProbe.status===0,"runtime fingerprint must include build inputs and exclude Go test-only files");
check(dev.includes("@('postgres', 'mailpit', 'media', 'identity', 'dsh', 'wlt')"),"backend readiness must include media dependency");
check(dev.includes("Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')"),"cold backend readiness must retain canonical Compose build reconciliation");
check(dev.includes("Compose @('up', '-d', '--no-build', '--wait', '--wait-timeout', '300', '--remove-orphans')"),"warm/selective backend reconciliation must not rebuild unchanged images");
check(dev.includes("Compose (@('build') + $buildServices.ToArray())"),"changed backend source must rebuild only the affected backend image set");
check(dev.includes("Compose @('ps', '-a', '--format', '{{.ID}}|{{.Service}}|{{.State}}|{{.Health}}')"),"backend readiness must use one canonical Compose state read per observation");
check(!/\badb(?:\.exe)?\b/i.test(dev)&&!dev.toLowerCase().includes("scrcpy"),"dev.ps1 must not retain device or scrcpy ownership");
check(!dev.includes("Active-Ports")&&!dev.includes("GetActiveTcpListeners"),"backend reuse must not trust occupied host ports");
check(hostCleanup.includes("app-(?:client|partner|captain|field)")&&hostCleanup.includes("control-panel")&&hostCleanup.includes("node_modules")&&hostCleanup.includes("expo")&&hostCleanup.includes("next"),"runtime:down must select only the canonical Expo and Next surface entrypoints");
check(!hostCleanup.includes("$command.Contains($Root"),"runtime:down must not terminate every Node process belonging to the repository");
check(hostCleanup.includes("taskkill.exe /PID $processId /T /F"),"runtime:down must stop each owned surface process tree without killing unrelated repository processes");
check(cleanupPatternSources.length===2,"runtime:down must expose exactly the two canonical app-surface process patterns");
for(const [name,command,expected] of [
  ["Expo",`node ${path.join(root,"apps/app-client/node_modules/expo/bin/cli")} start --dev-client --localhost`,true],
  ["Next",`node ${path.join(root,"apps/control-panel/node_modules/next/dist/bin/next")} dev -H 127.0.0.1`,true],
  ["Nx daemon",`node ${path.join(root,"node_modules/.pnpm/nx@23.2.0/node_modules/nx/dist/src/daemon/server/start.js")}`,false],
  ["repository verifier",`node ${path.join(root,"tools/dev/verify-cache-contracts.mjs")}`,false],
]) check(ownedSurfaceMatches(command)===expected,`runtime:down process selection mismatch for ${name}`);
check(scr.includes("$env:ADB=$Adb"),"scr.ps1 must pin scrcpy to the exact ADB executable used by the script");
check(scr.includes("--select-usb")&&scr.includes("--serial"),"scr.ps1 must preserve explicit USB-first and TCP selectors");
check(scr.includes("SCRCPY_FAILOVER")&&scr.includes("SCRCPY_FAILBACK"),"scr.ps1 must preserve automatic TCP failover and USB failback");
check(scr.includes(" reverse ")&&scr.includes("SAMRIM_IDENTITY_PORT")&&scr.includes("SAMRIM_DSH_PORT"),"scr.ps1 must own backend reverse mappings");
check(!scr.includes("SAMRIM_APP_CLIENT_METRO_PORT")&&!scr.includes("SAMRIM_APP_PARTNER_METRO_PORT")&&!scr.includes("SAMRIM_APP_CAPTAIN_METRO_PORT")&&!scr.includes("SAMRIM_APP_FIELD_METRO_PORT"),"scr.ps1 must not waste startup on Metro reverse mappings");
check(scr.includes("ADB_REFUSE_TCP_WHILE_USB_PRESENT"),"scr.ps1 must keep USB and TCP host transports mutually exclusive");
check(!scr.includes(" start-server"),"scr.ps1 must let the first real ADB command start the daemon on demand");
const firstUsbStart=scr.indexOf("$process=Start-Scrcpy @('--select-usb')");
const firstTcpPrepare=scr.indexOf("[void](Prepare-Tcp)");
check(firstUsbStart>=0&&firstTcpPrepare>firstUsbStart,"USB scrcpy must become live before TCP fallback preparation");
check(launcher.includes("process.cwd()"),"surface launcher must preserve package working directory");
check(launcher.includes('EXPO_NO_METRO_WORKSPACE_ROOT="1"'),"mobile launcher must keep app-scoped Metro root");
check(launcher.includes('"--dev-client","--localhost","--port"'),"mobile launcher must directly start Expo");
check(launcher.includes('"dev","-H","127.0.0.1","-p"'),"control launcher must directly start Next");
check(launcher.includes("url=http://localhost:${port}"),"control launcher must expose localhost as the canonical developer browser origin");

const persistentLocalTooling=[dev,scr,launcher,mobilePrepare,mobileBuild].join("\n");
check(!/\badb(?:\.exe)?\b[^\r\n]*\buninstall\b/i.test(persistentLocalTooling),"persistent local tooling must not uninstall Android apps");
check(!/\bpm\s+clear\b/i.test(persistentLocalTooling),"persistent local tooling must not clear Android app data");
check(!/\bdocker\s+volume\s+rm\b/i.test(persistentLocalTooling),"persistent local tooling must not remove Docker volumes");
check(!/\bdown\b[^\r\n]*(?:--volumes|\s-v(?:\s|$))/i.test(dev),"daily runtime shutdown must not delete Compose volumes");
check(liveRunner.includes('process.env.CI === "true"')&&liveRunner.includes('proofScope === "disposable-ci"')&&!liveRunner.includes('"isolated-local-actors"'),"live Identity browser runner must require disposable CI state");
check(identityRuntimeProof.includes('process.env.CI === "true"')&&identityRuntimeProof.includes('proofScope === "disposable-ci"')&&!identityRuntimeProof.includes('"isolated-local-actors"'),"Identity runtime proof must require disposable CI state");
for(const [name,source] of [["DSH runtime proof",dshRuntimeProof],["Location Core runtime proof",dshLocationRuntimeProof]]){
  check(source.includes('process.env.CI !== "true"')&&source.includes('process.env.BTHWANI_IDENTITY_PROOF_SCOPE !== "disposable-ci"')&&!source.includes('"isolated-local-actors"'),`${name} must require disposable CI state`);
}
check(dshProject.targets?.["location-proof"]?.cache===false,"DSH location proof must be an uncached Nx runtime target");
check(dshProject.targets?.["location-proof"]?.options?.command==="node tools/dev/verify-dsh-location-runtime.mjs --env-file=infra/local/.env","DSH location proof must execute the canonical location runtime proof");
check((dshProject.targets?.["location-proof"]?.inputs??[]).includes("{workspaceRoot}/tools/dev/verify-dsh-location-runtime.mjs"),"DSH location proof must hash its external runtime proof source");
check(liveIdentitySpec.includes("provisionIndependentOperator")&&!liveIdentitySpec.includes("phoneE164: operator.phone"),"live Identity browser proof must enroll an independent test actor instead of re-enrolling a current operator");
check(!liveIdentityHelpers.includes("DELETE FROM")&&!liveIdentityHelpers.includes("cleanupPreparedOperator"),"live Identity fixture helper must not delete business state directly");
check(liveIdentityHelpers.includes("identity_bootstrap_state b JOIN identity_actors a")&&liveIdentityHelpers.includes("item.actorId === bootstrap.actorId"),"live Identity fixtures must select and API-verify the canonical bootstrap Operator instead of relying on search ordering");
check(!identityRuntimeProof.includes("DELETE FROM"),"Identity runtime proof must not delete business state directly");
check(liveFinanceSpec.includes("enrollAndAuthenticateIsolatedOperator")&&liveFinanceSpec.includes('["finance"]'),"live Finance browser proof must use a disposable actor with scoped Finance permission");
check(!liveDshOperatorSpec.includes("cleanupPreparedOperator"),"live DSH operator fixture must rely on disposable CI database teardown");
check(!liveDshOperatorSpec.includes("operators.length > 1")&&!liveDshOperatorSpec.includes("operators[0]"),"live DSH fixture must remain stable when disposable proof actors accumulate");
check(!/\bDELETE\s+FROM\b/i.test(dshRuntimeProof)&&!dshRuntimeProof.includes("cleanupCheckerFixture"),"DSH runtime proof must not clean up business state with direct SQL");
check(!/\bDELETE\s+FROM\b/i.test(dshLocationRuntimeProof)&&!dshLocationRuntimeProof.includes("function cleanup"),"Location Core runtime proof must not clean up business state with direct SQL");
check(ciRuntimeRunner.includes('"down"')||read(".github/workflows/ci-runtime.yml").includes("--volumes"),"CI runtime proof must rely on disposable environment teardown for persistent fixture cleanup");
check(!/request\(identityBase,\s*"PUT",\s*`\/internal\/operators\/\$\{encodeURIComponent\(checkerOperatorID\)\}/.test(dshRuntimeProof),"DSH runtime proof must not grant permissions to an existing checker operator");

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].toSorted(compareStrings)) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("INFRA_RUNTIME_OWNER=tools/dev/dev.ps1");
console.log("DEVICE_OWNER=tools/dev/scr.ps1");
console.log("SURFACE_RUNTIME_OWNER=apps/*/package.json");
console.log("SURFACE_SHARED_LAUNCHER=tools/dev/start-surface.mjs");
console.log("MOBILE_OPEN_MODE=MANUAL");
console.log("ADB_TRANSPORT=USB_PREFERRED_TCP_FALLBACK_SINGLE_ACTIVE");
