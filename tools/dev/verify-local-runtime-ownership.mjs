import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const exists=(p)=>fs.existsSync(path.join(root,p));
const pkg=JSON.parse(read("package.json"));
const dev=read("tools/dev/dev.ps1");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};

const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
const scripts={
  dev:"daily",client:"client",partner:"partner",captain:"captain",field:"field",
  control:"control",scr:"scr","runtime:up":"up","runtime:down":"down","runtime:status":"status",
};
for(const [name,target] of Object.entries(scripts)){
  check(pkg.scripts?.[name]===`${run} ${target}`,`${name} must route to dev.ps1`);
}

for(const old of [
  "tools/dev/local.ps1","tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/device-policy.psm1",
  "tools/dev/open-mobile-apps.ps1","tools/dev/run-control.ps1","tools/dev/scrcpy.ps1"
]) check(!exists(old),`retired runtime file remains: ${old}`);

for(const token of [
  "ValidateSet('daily','client','partner','captain','field','control','scr','up','down','status')",
  "DEV_TIMING","DEV_READY=PASS","Start-HiddenNode","--dns-result-order=ipv4first",
  "node_modules\\expo\\bin\\cli","node_modules\\next\\dist\\bin\\next"
]) check(dev.includes(token),`dev.ps1 missing invariant: ${token}`);

check(/\$env:EXPO_OFFLINE\s*=\s*['"]1['"]/.test(dev), "dev.ps1 must keep Expo offline");
check(/\$env:EXPO_NO_QR_CODE\s*=\s*['"]1['"]/.test(dev), "dev.ps1 must suppress Expo QR output");
check(/\$env:EXPO_NO_TYPESCRIPT_SETUP\s*=\s*['"]1['"]/.test(dev), "dev.ps1 must disable Expo TypeScript auto-setup");
check(/@\(['"]reverse['"],['"]--list['"]\)/.test(dev), "dev.ps1 must read ADB reverse mappings");
check(/@\(['"]reverse['"],\s*["']tcp:\$port["'],\s*["']tcp:\$port["']\)/.test(dev), "dev.ps1 must repair missing ADB reverse mappings");

for(const bad of [
  "pnpm --dir","adb devices","ANDROID_SERIAL","adb -s","scrcpy -s","adb tcpip","getprop",
  "WIFI","wifi","METRO_START_TIMEOUT","EXPO_NO_TELEMETRY"
]) check(!dev.includes(bad),`dev.ps1 retains removed overhead: ${bad}`);

check((dev.match(/Start-Process/g)||[]).length===2,"dev.ps1 must use Start-Process only for background Node servers and scrcpy");
check(!/\[string\[\]\]\$Args\b/.test(dev), "dev.ps1 must not shadow PowerShell's automatic $Args variable");
check(!pkg.scripts?.["runtime:doctor"],"runtime:doctor must remain absent");

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].sort()) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("LOCAL_RUNTIME_OWNER=tools/dev/dev.ps1");
console.log("LOCAL_RUNTIME_OWNER_FILES=1");
console.log("DAILY_ENTRYPOINT=pnpm dev");
console.log("DEVICE_DISCOVERY_WRAPPER=0");
console.log("NESTED_PNPM=0");
