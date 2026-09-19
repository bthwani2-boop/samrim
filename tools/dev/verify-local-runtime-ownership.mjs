import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const pkg=JSON.parse(read("package.json"));
const dev=read("tools/dev/dev.ps1");
const launcher=read("tools/dev/start-surface.mjs");
const mobilePrepare=read("tools/mobile/prepare-local-development.ps1");
const mobileBuild=read("tools/mobile/build-development.ps1");
const liveRunner=read("tools/dev/run-playwright-live.mjs");
const identityRuntimeProof=read("tools/dev/verify-identity-runtime.mjs");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};

const ps=spawnSync("pwsh",["-NoProfile","-Command",
  "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"
],{cwd:root,encoding:"utf8"});
check(ps.status===0,"dev.ps1 PowerShell syntax must parse cleanly");
for(const script of ["tools/dev/start-surface.mjs","tools/dev/run-playwright-live.mjs","tools/dev/verify-identity-runtime.mjs"]){
  check(spawnSync(process.execPath,["--check",script],{cwd:root}).status===0,`${script} syntax must parse cleanly`);
}

const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
for(const [name,target] of Object.entries({dev:"daily","runtime:up":"up","runtime:down":"down","runtime:status":"status",scr:"scr"})){
  check(pkg.scripts?.[name]===`${run} ${target}`,`${name} must route to infra/device owner`);
}
for(const [name,dir] of Object.entries({client:"app-client",partner:"app-partner",captain:"app-captain",field:"app-field",control:"control-panel"})){
  check(pkg.scripts?.[name]===`pnpm --dir apps/${dir} dev`,`${name} must enter its own package directory`);
  const surfacePkg=JSON.parse(read(`apps/${dir}/package.json`));
  check(surfacePkg.scripts?.dev==="node ../../tools/dev/start-surface.mjs",`${name} package must own direct dev startup`);
}
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
check(!dev.includes("dist\\bin\\next"),"dev.ps1 must not launch Next");
check(dev.includes("Read-RunningBackendServices"),"dev.ps1 must read canonical Compose service state after reconciliation");
check(dev.includes("Compose @(\'up\',\'-d\',\'--build\',\'--wait\',\'--wait-timeout\',\'300\',\'--remove-orphans\')"),"backend readiness must reconcile current source through Compose build before declaring ready");
check(dev.includes("Compose @(\'ps\',\'--status\',\'running\',\'--services\')"),"backend readiness must read back running Compose services after reconciliation");
check(dev.includes("Read-DeviceReversePorts"),"device reverse ports must be resolved only by the device path");
check(!dev.includes("$Map=Read-Env"),"backend startup must not eagerly resolve device-only port configuration");
check(!dev.includes("Active-Ports")&&!dev.includes("GetActiveTcpListeners"),"backend reuse must not trust occupied host ports");
check(dev.includes("Ensure-Scrcpy"),"dev.ps1 must retain device/scrcpy ownership");
check(launcher.includes("process.cwd()"),"surface launcher must preserve package working directory");
check(launcher.includes('EXPO_NO_METRO_WORKSPACE_ROOT="1"'),"mobile launcher must keep app-scoped Metro root");
check(launcher.includes('"--dev-client","--localhost","--port"'),"mobile launcher must directly start Expo");
check(launcher.includes('"dev","-H","127.0.0.1","-p"'),"control launcher must directly start Next");
check(launcher.includes("url=http://localhost:${port}"),"control launcher must expose localhost as the canonical developer browser origin");

const persistentLocalTooling=[dev,launcher,mobilePrepare,mobileBuild].join("\n");
check(!/\badb(?:\.exe)?\b[^\r\n]*\buninstall\b/i.test(persistentLocalTooling),"persistent local tooling must not uninstall Android apps");
check(!/\bpm\s+clear\b/i.test(persistentLocalTooling),"persistent local tooling must not clear Android app data");
check(!/\bdocker\s+volume\s+rm\b/i.test(persistentLocalTooling),"persistent local tooling must not remove Docker volumes");
check(!/\bdown\b[^\r\n]*(?:--volumes|\s-v(?:\s|$))/i.test(dev),"daily runtime shutdown must not delete Compose volumes");
for(const [name,source] of [["live Identity browser runner",liveRunner],["Identity runtime proof",identityRuntimeProof]]){
  check(source.includes('process.env.CI === "true"')&&source.includes('BTHWANI_IDENTITY_PROOF_SCOPE')&&source.includes('"disposable-ci"'),`${name} must fail closed outside explicitly disposable CI state`);
}

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].sort()) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("INFRA_DEVICE_OWNER=tools/dev/dev.ps1");
console.log("SURFACE_RUNTIME_OWNER=apps/*/package.json");
console.log("SURFACE_SHARED_LAUNCHER=tools/dev/start-surface.mjs");
console.log("MOBILE_OPEN_MODE=MANUAL");
console.log("ADB_TRANSPORT=USB_PREFERRED_TCP_FALLBACK_SINGLE_ACTIVE");
