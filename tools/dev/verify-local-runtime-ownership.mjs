import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const pkg=JSON.parse(read("package.json"));
const dev=read("tools/dev/dev.ps1");
const launcher=read("tools/dev/start-surface.mjs");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};

const ps=spawnSync("pwsh",["-NoProfile","-Command",
  "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"
],{cwd:root,encoding:"utf8"});
check(ps.status===0,"dev.ps1 PowerShell syntax must parse cleanly");
check(spawnSync(process.execPath,["--check","tools/dev/start-surface.mjs"],{cwd:root}).status===0,"start-surface.mjs syntax must parse cleanly");

const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
for(const [name,target] of Object.entries({dev:"daily","runtime:up":"up","runtime:down":"down","runtime:status":"status",scr:"scr"})){
  check(pkg.scripts?.[name]===`${run} ${target}`,`${name} must route to infra/device owner`);
}
for(const [name,dir] of Object.entries({client:"app-client",partner:"app-partner",captain:"app-captain",field:"app-field",control:"control-panel"})){
  check(pkg.scripts?.[name]===`pnpm --dir apps/${dir} dev`,`${name} must enter its own package directory`);
  const surfacePkg=JSON.parse(read(`apps/${dir}/package.json`));
  check(surfacePkg.scripts?.dev==="node ../../tools/dev/start-surface.mjs",`${name} package must own direct dev startup`);
}
for(const removed of ["Start-MobileServer","Start-ControlServer","Stop-OwnedListener","Get-OwnedNodeTreeRoot","Wait-Servers","Ensure-HostServers","Ensure-OneMobile","Ensure-ControlOnly"]){
  check(!dev.includes(removed),`dev.ps1 retains surface runtime ownership: ${removed}`);
}
check(!dev.includes("--dev-client"),"dev.ps1 must not launch Expo");
check(!dev.includes("dist\\bin\\next"),"dev.ps1 must not launch Next");
check(dev.includes("Ensure-Scrcpy"),"dev.ps1 must retain device/scrcpy ownership");
check(launcher.includes("process.cwd()"),"surface launcher must preserve package working directory");
check(launcher.includes('EXPO_NO_METRO_WORKSPACE_ROOT="1"'),"mobile launcher must keep app-scoped Metro root");
check(launcher.includes('"--dev-client","--localhost","--port"'),"mobile launcher must directly start Expo");
check(launcher.includes('"dev","-H","127.0.0.1","-p"'),"control launcher must directly start Next");

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
