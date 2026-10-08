import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(toolDir,"../..");
const appsRoot=path.join(repoRoot,"apps");
const envPath=path.join(repoRoot,"infra/local/.env");

function fail(message){
  console.error(message);
  process.exit(1);
}

const surfaceRoots=new Map([
  ["app-client",path.join(appsRoot,"app-client")],
  ["app-partner",path.join(appsRoot,"app-partner")],
  ["app-captain",path.join(appsRoot,"app-captain")],
  ["app-field",path.join(appsRoot,"app-field")],
  ["control-panel",path.join(appsRoot,"control-panel")],
]);
const requestedSurface=(process.argv[2]??"").trim();
if(requestedSurface&&!surfaceRoots.has(requestedSurface)){
  fail("UNSUPPORTED_LOCAL_SURFACE");
}
const surfaceRoot=requestedSurface?surfaceRoots.get(requestedSurface):process.cwd();
const surface=path.basename(surfaceRoot);
if(path.dirname(surfaceRoot)!==appsRoot||!surfaceRoots.has(surface)){
  fail(`LOCAL_SURFACE_ROOT_REQUIRED cwd=${surfaceRoot} expected_parent=${appsRoot}`);
}
if(!fs.existsSync(envPath)){
  fail("LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env");
}

for(const raw of fs.readFileSync(envPath,"utf8").split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith("#")) continue;
  const separator=line.indexOf("=");
  if(separator<1) fail("LOCAL_ENV_INVALID");
  process.env[line.slice(0,separator).trim()]=line.slice(separator+1).trim();
}

function need(name){
  const value=process.env[name]?.trim();
  if(!value) fail(`LOCAL_ENV_MISSING_VALUE name=${name}`);
  return value;
}

let cli;
let args;

if(/^app-(client|partner|captain|field)$/.test(surface)){
  const token=surface.replace(/[^A-Za-z0-9]/g,"_").toUpperCase();
  const port=need(`SAMRIM_${token}_METRO_PORT`);
  process.env.EXPO_NO_QR_CODE="1";
  process.env.EXPO_NO_TYPESCRIPT_SETUP="1";
  if(!process.env.NODE_OPTIONS?.includes("--dns-result-order=ipv4first")){
    process.env.NODE_OPTIONS=((process.env.NODE_OPTIONS??"")+" --dns-result-order=ipv4first").trim();
  }

  cli=path.join(surfaceRoot,"node_modules","expo","bin","cli");
  args=[cli,"start","--dev-client","--localhost","--port",port];
  console.log(`MOBILE_LIVE app=${surface} port=${port} fast_refresh=on open=manual cwd=${surfaceRoot}`);
}else if(surface==="control-panel"){
  const port=need("SAMRIM_CONTROL_PORT");
  process.env.NEXT_PUBLIC_CONTROL_PANEL_DEVELOPMENT_LOGIN = process.env.BTHWANI_ENV === "development" &&
    process.env.BTHWANI_AUTH_JOURNEY_PROOF !== "1" &&
    Boolean(process.env.CONTROL_PANEL_DEVELOPMENT_PASSWORD?.trim()) ? "1" : "0";
  process.env.NEXT_TELEMETRY_DISABLED="1";
  cli=path.join(surfaceRoot,"node_modules","next","dist","bin","next");
  args=[cli,"dev","-H","127.0.0.1","-p",port];
  console.log(`CONTROL_LIVE url=http://localhost:${port} listen=127.0.0.1:${port} hmr=on cwd=${surfaceRoot}`);
}else{
  fail(`UNSUPPORTED_LOCAL_SURFACE surface=${surface}`);
}

if(!fs.existsSync(cli)){
  fail(`LOCAL_DEPENDENCY_NOT_MATERIALIZED cli=${cli} run=pnpm_bootstrap`);
}

if(surface.startsWith("app-")){
  const check=spawnSync(process.execPath,[path.join(repoRoot,"tools/mobile/verify-mobile-config.mjs"),"--app",surface],{
    cwd:repoRoot,
    env:process.env,
    stdio:"inherit",
    windowsHide:true,
  });
  if(check.error) throw check.error;
  if(check.status!==0) process.exit(check.status??1);
}

const result=spawnSync(process.execPath,args,{
  cwd:surfaceRoot,
  env:process.env,
  stdio:"inherit",
  windowsHide:false,
});

if(result.error) throw result.error;
if(result.signal) process.exit(result.signal==="SIGINT"?130:1);
process.exit(result.status??1);
