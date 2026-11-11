import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const applications = ["app-client", "app-partner", "app-captain"];
const scopeByApp = { "app-client": "clientSessionKey", "app-partner": "partnerSetupSessionKey", "app-captain": "captainSessionKey" };
const owner = resolve(root, "packages/push-device/src/index.ts");
const source = readFileSync(owner, "utf8");

test("shared native push owner retains iOS support and rejects web", () => {
  // The native iOS/Android/web behavior, actor scoping, and bounded logout
  // replay are tested by packages/push-device/src/push-device.test.mjs.
  // Do not pin the number of guards or the asynchronous implementation shape.
  assert.doesNotMatch(source, /Platform\.OS\s*!==\s*"android"/);
  assert.match(source, /Platform\.OS\s*===\s*"web"/);
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
    const scope = scopeByApp[app];
    assert.ok(monitor.includes(`const sessionKey = ${scope}(session);`), "the monitor must use the existing app-owned Identity session scope");
    assert.match(monitor, /const stillCurrent = \(\) => !cancelled && AppState.currentState === "active" && isCurrentAlertSession\(sessionKey\);/);
    assert.match(monitor, /registerOwnPushDevice\(token, actor, chosenTone, stillCurrent, url\)/);
    assert.match(monitor, /alerts.receive\(role, sessionKey, data.notifications\)/);
    assert.match(monitor, /scheduledSessions.get\(result.notification.request.identifier\)/);
    assert.match(monitor, /cancelScheduledNotificationAsync\(notificationId\)/);
    assert.doesNotMatch(monitor, /alerts.receive\(role, actor, data.notifications\)/);
    assert.doesNotMatch(login + monitor, /from ["'](?:\.\/|\.\.\/features\/notifications\/)push-device["']/);
  });
}
