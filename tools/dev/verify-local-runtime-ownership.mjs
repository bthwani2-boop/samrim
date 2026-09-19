import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const exists=(p)=>fs.existsSync(path.join(root,p));
const pkg=JSON.parse(read("package.json"));
const dev=read("tools/dev/dev.ps1");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};

const ps = spawnSync("pwsh", ["-NoProfile","-Command",
  "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}"
], { cwd: root, encoding: "utf8" });
check(ps.status === 0, "dev.ps1 PowerShell syntax must parse cleanly" + (ps.stderr?.trim() ? ": " + ps.stderr.trim() : ""));


const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
check(pkg.scripts?.dev===`${run} daily`,"dev must route to dev.ps1 daily");
check(pkg.scripts?.["runtime:up"]===`${run} up`,"runtime:up must route to dev.ps1");
check(pkg.scripts?.["runtime:down"]===`${run} down`,"runtime:down must route to dev.ps1");
check(pkg.scripts?.["runtime:status"]===`${run} status`,"runtime:status must route to dev.ps1");

for(const retiredScript of ["client","partner","captain","field","control","scr","runtime:doctor"]){
  check(pkg.scripts?.[retiredScript]===undefined,`retired daily script remains: ${retiredScript}`);
}
for(const old of [
  "tools/dev/local.ps1","tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/device-policy.psm1",
  "tools/dev/open-mobile-apps.ps1","tools/dev/run-control.ps1","tools/dev/scrcpy.ps1"
]) check(!exists(old),`retired runtime file remains: ${old}`);

for(const token of [
  "ValidateSet('daily','up','down','status')","DEV_TIMING","DEV_READY=PASS",
  "EXPO_OFFLINE='1'","EXPO_NO_QR_CODE='1'","EXPO_NO_TYPESCRIPT_SETUP='1'",
  "--dns-result-order=ipv4first","node_modules\\expo\\bin\\cli","node_modules\\next\\dist\\bin\\next",
  "Ensure-Reverse","Ensure-HostServers","Ensure-Scrcpy","Stop-LocalHosts","--dev-client","--localhost"
]) check(dev.includes(token),`dev.ps1 missing invariant: ${token}`);

for(const bad of [
  "--android","am start","shell pidof","logcat","APP_EXITED","pnpm --dir","adb devices","ANDROID_SERIAL",
  "adb -s","scrcpy -s","adb tcpip","getprop","WIFI","wifi","METRO_START_TIMEOUT","EXPO_NO_TELEMETRY"
]) check(!dev.includes(bad),`dev.ps1 retains removed runtime behavior: ${bad}`);

check(!/\[string\[\]\]\$Args\b/.test(dev),"dev.ps1 must not shadow PowerShell's automatic $Args variable");
check(!/--dev-client[^\n\r]*--android/.test(dev),"Metro bootstrap must never auto-open Android apps");
check(/Start-Node \$root \$expo @\('start','--dev-client','--localhost','--port'/.test(dev),"Metro bootstrap must remain live for Fast Refresh");
check(/RUNTIME_DOWN=PASS scope=all-local-dev/.test(dev),"runtime:down must close the complete local dev runtime");

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].sort()) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("LOCAL_RUNTIME_OWNER=tools/dev/dev.ps1");
console.log("LOCAL_RUNTIME_OWNER_FILES=1");
console.log("DAILY_ENTRYPOINT=pnpm dev");
console.log("MOBILE_OPEN_MODE=MANUAL");
console.log("NESTED_PNPM=0");
