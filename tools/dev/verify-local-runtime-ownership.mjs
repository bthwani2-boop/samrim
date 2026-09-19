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

const ps=spawnSync("pwsh",["-NoProfile","-Command",
  "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'tools/dev/dev.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}"
],{cwd:root,encoding:"utf8"});
check(ps.status===0,"dev.ps1 PowerShell syntax must parse cleanly"+(ps.stderr?.trim()?": "+ps.stderr.trim():""));

const run="pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dev.ps1";
for(const [name,target] of Object.entries({
  dev:"daily","runtime:up":"up","runtime:down":"down","runtime:status":"status",
  client:"client",partner:"partner",captain:"captain",field:"field",control:"control",scr:"scr"
})){
  check(pkg.scripts?.[name]===`${run} ${target}`,`${name} must route to the single runtime owner`);
}

for(const old of [
  "tools/dev/local.ps1","tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/device-policy.psm1",
  "tools/dev/open-mobile-apps.ps1","tools/dev/run-control.ps1","tools/dev/scrcpy.ps1"
]) check(!exists(old),`retired runtime file remains: ${old}`);

for(const token of [
  "Get-UsbSerial","Prepare-TcpFallback","Connect-TcpFallback","Disconnect-TcpDevices","Get-AdbSelector",
  "Ensure-Reverse","Start-MobileServer","Start-ControlServer","Ensure-Scrcpy","Stop-LocalHosts",
  "EXPO_NO_METRO_WORKSPACE_ROOT='1'","--dev-client","--localhost","--select-usb","--serial","adb connect","adb disconnect","adb -d tcpip 5555",
  "Start-MobileServer $Name -Foreground","Start-ControlServer -Foreground",
  "MOBILE_LIVE","CONTROL_LIVE","SCRCPY_PREP","ADB_FALLBACK_PREPARE","SCRCPY_FAILOVER","SCRCPY_FAILBACK","DEV_READY=PASS"
]) check(dev.includes(token),`dev.ps1 missing invariant: ${token}`);

for(const bad of [
  "--android","am start","shell pidof","logcat","APP_EXITED","pnpm --dir",
  "ANDROID_SERIAL","Wireless Debugging","pairing code","adb pair","METRO_START_TIMEOUT"
]) check(!dev.includes(bad),`dev.ps1 retains forbidden runtime behavior: ${bad}`);

check(!dev.includes("reverse --list"),"reverse mappings must be direct/idempotent, not list-gated");
check(/function Get-AdbSelector[\s\S]*Get-UsbSerial[\s\S]*Disconnect-TcpDevices[\s\S]*return @\('-d'\)[\s\S]*Connect-TcpFallback/.test(dev),
  "ADB selector must prefer USB and use TCP only when USB is absent");
check(/function Connect-TcpFallback[\s\S]*ADB_REFUSE_TCP_WHILE_USB_PRESENT/.test(dev),
  "TCP fallback must refuse host TCP connection while USB is present");
check(/function Prepare-TcpFallback[\s\S]*getprop service\.adb\.tcp\.port[\s\S]*tcpip 5555[\s\S]*Disconnect-TcpDevices[\s\S]*Save-TcpEndpoint/.test(dev),
  "USB bootstrap must reuse an existing TCP listener when possible and never retain a concurrent TCP host connection");
const scrcpyBody=dev.slice(dev.indexOf("function Ensure-Scrcpy"),dev.indexOf("function Ensure-OneMobile"));
check(scrcpyBody.includes("--select-usb")&&scrcpyBody.includes("--serial")&&scrcpyBody.includes("SCRCPY_FAILOVER")&&scrcpyBody.includes("SCRCPY_FAILBACK"),
  "scrcpy must prefer USB and automatically fail over/fail back with explicit selectors");
check(/Ensure-Reverse -Ports @\(\$Identity,\$Dsh,\[int\]\$Metro\[\$Name\]\)/.test(dev),
  "targeted mobile command must apply reverse mappings to the active transport");
check(/Start-MobileServer \$Name -Foreground/.test(dev),
  "targeted mobile commands must stay attached to their terminal");
check(/Start-ControlServer -Foreground/.test(dev),
  "targeted control command must stay attached to its terminal");
check(/\$AppRoot\s*=\s*Join-Path\s+\$Root\s+"apps\\app-\$Name"/i.test(dev),
  "mobile working directory must derive from stable repository Root");
check(/\$ControlRoot\s*=\s*Join-Path\s+\$Root\s+'apps\\control-panel'/i.test(dev),
  "control working directory must derive from stable repository Root");
check(!/--dev-client[^\n\r]*--android/.test(dev),"runtime must never auto-open Android apps");
check(/RUNTIME_DOWN=PASS scope=all-local-dev/.test(dev),"runtime:down must close complete local dev state");
check(/DEV_STATE[^\n]*scrcpy=manual/.test(dev),"batch dev must leave scrcpy to the dedicated pnpm scr terminal");

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].sort()) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("LOCAL_RUNTIME_OWNER=tools/dev/dev.ps1");
console.log("LOCAL_RUNTIME_OWNER_FILES=1");
console.log("MOBILE_OPEN_MODE=MANUAL");
console.log("TARGETED_TERMINALS=FOREGROUND");
console.log("ADB_TRANSPORT=USB_PREFERRED_TCP_FALLBACK_SINGLE_ACTIVE");
