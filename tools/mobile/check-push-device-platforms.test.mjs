import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const applications = ["app-client", "app-partner", "app-captain"];

function isNativeOnly(source) {
  return /Platform\.OS\s*===\s*"web"\s*\|\|/.test(source);
}

for (const app of applications) {
  const path = resolve(root, "apps", app, "src/features/notifications/push-device.ts");
  const source = readFileSync(path, "utf8");

  test(`${app} registers and unregisters push devices on Android and iOS, not on web`, () => {
    assert.doesNotMatch(source, /Platform\.OS\s*!==\s*"android"/);
    const platformGuards = source.match(/if \(Platform\.OS === "web" \|\| !accessToken/g) ?? [];
    assert.equal(platformGuards.length, 2, "both registration and logout must gate on web only");
    assert.match(source, /await registrationInFlight\?\.task\.catch\(\(\) => false\)/);
    assert.match(source, /if \(!stillCurrent\(\)\) return false/);
    assert.match(source, /Notifications\.getExpoPushTokenAsync\(\{ projectId \}\)/);
    assert.match(source, /Bearer \$\{accessToken\}/);
    assert.equal(isNativeOnly(source), true);
  });
}

test("platform guard detects an accidental Android-only push regression", () => {
  const source = readFileSync(
    resolve(root, "apps/app-partner/src/features/notifications/push-device.ts"),
    "utf8",
  );
  const broken = source.replace('Platform.OS === "web"', 'Platform.OS !== "android"');
  assert.notEqual(source, broken);
  assert.match(broken, /Platform\.OS !== "android"/);
});
