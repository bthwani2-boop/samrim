import { execFileSync } from "node:child_process";
import { ANDROID_EXPO_APPS, androidAppReadiness } from "./check-android-expo-readiness-core.mjs";

function adb(args) {
  return execFileSync("adb", args, { encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

const strict = process.argv.includes("--strict");
const serial = process.argv.indexOf("--serial");
const base = serial === -1 ? [] : ["-s", process.argv[serial + 1]];
if (serial !== -1 && !process.argv[serial + 1]) throw new Error("ANDROID_SERIAL_REQUIRED");
const devices = adb(["devices"]).split("\n").slice(1).filter((line) => /\tdevice\s*$/.test(line));
if (devices.length !== 1 && serial === -1) {
  console.error("Specify --serial when zero or multiple Android devices are connected.");
  process.exit(2);
}

const apps = {};
for (const [name, config] of Object.entries(ANDROID_EXPO_APPS)) {
  const dump = adb([...base, "shell", "dumpsys", "package", config.packageName]);
  apps[name] = androidAppReadiness(dump, config.requiredForProof);
}
const result = { androidRelease: adb([...base, "shell", "getprop", "ro.build.version.release"]).trim(), apps };
console.log(JSON.stringify(result, null, 2));
if (strict && Object.values(apps).some((app) => !app.readyForProof)) process.exitCode = 1;
