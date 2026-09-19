import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const localPath = path.join(root, "tools/dev/local.ps1");
const local = fs.readFileSync(localPath, "utf8");
const fail = [];
const check = (ok, message) => { if (!ok) fail.push(message); };

const compose = "docker compose --ansi never --project-name samrim-local --env-file infra/local/.env -f infra/local/compose/compose.yaml";
const host = { client:"client", partner:"partner", captain:"captain", field:"field", control:"control" };

for (const [name,target] of Object.entries(host)) {
  check(pkg.scripts?.[name] === `pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/local.ps1 ${target}`, `${name} must route to local.ps1`);
}
check(pkg.scripts?.scr === "scrcpy --max-size=1280 --max-fps=30 --video-bit-rate=4M --no-audio", "scr must delegate directly to scrcpy");
check(pkg.scripts?.["runtime:up"] === `${compose} up -d --wait --wait-timeout 300 --remove-orphans`, "runtime:up must delegate directly to Compose");
check(pkg.scripts?.["runtime:down"] === `${compose} down --remove-orphans`, "runtime:down must delegate directly to Compose");
check(pkg.scripts?.["runtime:status"] === `${compose} ps -a`, "runtime:status must delegate directly to Compose");
check(pkg.scripts?.["runtime:doctor"] === undefined, "runtime:doctor wrapper must be absent");

for (const old of [
  "tools/dev/runtime.ps1","tools/dev/runtime.psm1","tools/dev/device-policy.psm1",
  "tools/dev/open-mobile-apps.ps1","tools/dev/run-control.ps1","tools/dev/scrcpy.ps1"
]) {
  check(!fs.existsSync(path.join(root, old)), `retired runtime wrapper remains: ${old}`);
}

for (const token of [
  "EXPO_OFFLINE = '1'",
  "EXPO_NO_QR_CODE = '1'",
  "EXPO_NO_TYPESCRIPT_SETUP = '1'",
  "node_modules\\expo\\bin\\cli",
  "node_modules\\next\\dist\\bin\\next",
  "adb reverse --list",
  "APP_REUSE=PASS",
  "CONTROL_REUSE=PASS",
  "--dns-result-order=ipv4first",
]) {
  check(local.includes(token), `local.ps1 missing invariant: ${token}`);
}

for (const bad of [
  "pnpm --dir","adb devices","ANDROID_SERIAL","adb -s","scrcpy -s","adb tcpip",
  "getprop","WIFI","wifi","Start-Process","METRO_START_TIMEOUT","EXPO_NO_TELEMETRY"
]) {
  check(!local.includes(bad), `local.ps1 retains removed overhead: ${bad}`);
}

if (fail.length) {
  console.error("LOCAL_RUNTIME_OWNERSHIP=FAIL");
  for (const item of [...new Set(fail)].sort()) console.error("  " + item);
  process.exit(1);
}

console.log("LOCAL_RUNTIME_OWNERSHIP=PASS");
console.log("HOST_APP_HELPER=tools/dev/local.ps1");
console.log("DOCKER_RUNTIME_OWNER=Docker Compose");
console.log("SCRCPY_OWNER=scrcpy");
console.log("NESTED_PNPM=0");
console.log("DEVICE_DISCOVERY_WRAPPER=0");
