import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const applications = ["app-client", "app-partner", "app-captain"];
const owner = resolve(root, "packages/push-device/src/index.ts");
const source = readFileSync(owner, "utf8");

test("native push owner never excludes iOS and never registers on web", () => {
  assert.doesNotMatch(source, /Platform\.OS\s*!==\s*"android"/);
  assert.equal((source.match(/if \(Platform\.OS === "web" \|\| !accessToken/g) ?? []).length, 2);
  assert.match(source, /await registrationInFlight\?\.task\.catch\(\(\) => false\)/);
  assert.match(source, /if \(!stillCurrent\(\)\) return false/);
  assert.match(source, /Notifications\.getExpoPushTokenAsync\(\{ projectId \}\)/);
  assert.match(source, /Bearer \$\{accessToken\}/);
});

test("the package takes its API URL from each host and does not hide a stale public env read", () => {
  assert.match(source, /function endpoint\(apiBaseUrl: string \| undefined\)/);
  assert.match(source, /endpoint\(apiBaseUrl\)/);
  assert.doesNotMatch(source, /process\.env\.EXPO_PUBLIC_/);
});

for (const app of applications) {
  test(`${app} consumes one shared push owner for alert monitor and identity logout`, () => {
    const prefix = resolve(root, "apps", app);
    assert.equal(existsSync(resolve(prefix, "src/features/notifications/push-device.ts")), false);
    const packageManifest = JSON.parse(readFileSync(resolve(prefix, "package.json"), "utf8"));
    assert.equal(packageManifest.dependencies["@bthwani/push-device"], "workspace:*");
    const login = readFileSync(resolve(prefix, "src/bootstrap/identity.ts"), "utf8");
    const monitor = readFileSync(resolve(prefix, "src/features/notifications/order-alert-monitor.tsx"), "utf8");
    assert.match(login, /import \{ unregisterOwnPushDevice \} from "@bthwani\/push-device"/);
    assert.match(login, /await unregisterOwnPushDevice\(token, process\.env\.EXPO_PUBLIC_DSH_API_URL\)/);
    assert.match(monitor, /import \{ hasNativeNotificationModules, registerOwnPushDevice \} from "@bthwani\/push-device"/);
    assert.match(monitor, /current\.identity\.subject\.trim\(\) === actor;\s*\}, url\)/);
    assert.doesNotMatch(login + monitor, /from ["'](?:\.\/|\.\.\/features\/notifications\/)push-device["']/);
  });
}

test("platform guard detects a regressed Android-only registration", () => {
  const broken = source.replace('Platform.OS === "web"', 'Platform.OS !== "android"');
  assert.notEqual(broken, source);
  assert.match(broken, /Platform\.OS !== "android"/);
});
