import fs from "node:fs";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"../..");
const fail=[];
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const exists=(p)=>fs.existsSync(path.join(root,p));
const pkg=JSON.parse(read("package.json"));
const local=read("tools/dev/local.ps1");
const compose=read("infra/local/compose/compose.yaml");
const check=(ok,msg)=>{if(!ok)fail.push(msg)};

const scripts={
  client:"Client",partner:"Partner",captain:"Captain",field:"Field",control:"Control",scr:"Scrcpy",
  "runtime:up":"Up","runtime:down":"Down","runtime:status":"Status","runtime:doctor":"Doctor",
};
for(const [name,action] of Object.entries(scripts)){
  check(pkg.scripts?.[name]===`pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local.ps1 -Action ${action}`,`${name} must route directly to local.ps1`);
}
for(const old of [
  "tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/device-policy.psm1",
  "tools/dev/open-mobile-apps.ps1","tools/dev/run-control.ps1","tools/dev/scrcpy.ps1"
]) check(!exists(old),`retired local runtime file remains: ${old}`);

for(const token of [
  "ValidateSet('Up','Down','Status','Doctor','Control','Client','Partner','Captain','Field','Scrcpy')",
  "function Mobile","APP_REUSE=PASS","expo start --dev-client --localhost --android --scheme",
  "--dns-result-order=ipv4first","EXPO_NO_TYPESCRIPT_SETUP='1'",
  "CONTROL_REUSE=PASS","next dev -H 127.0.0.1","function Usb","function Reverse"
]) check(local.includes(token),`local.ps1 missing invariant: ${token}`);

for(const bad of ["adb tcpip","getprop","WIFI","wifi","Start-Process","METRO_START_TIMEOUT","runtime.psm1"]){
  check(!local.includes(bad),`local.ps1 retains removed complexity: ${bad}`);
}
for(const bad of ["metro-client:","metro-partner:","metro-captain:","metro-field:","js-deps:","/workspace","samrim-js-"]){
  check(!compose.includes(bad),`compose retains JS runtime residue: ${bad}`);
}

if(fail.length){
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for(const x of [...new Set(fail)].sort()) console.error("  "+x);
  process.exit(1);
}
console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("LOCAL_RUNTIME_OWNER=tools/dev/local.ps1");
console.log("LOCAL_RUNTIME_OWNER_FILES=1");
console.log("DOCKER_JS_APPLICATION_SERVICES=0");
console.log("PARALLEL_RUNTIME_MODE=0");
