import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { defineBthwaniExpoApp } = require("./define-bthwani-expo-app.cjs");

const apps = [
  ["app-client", "app-client", "com.bthwani.client", "4adf3184-fc07-4186-b49e-0dc821a5ab73"],
  ["app-partner", "app-partner", "com.bthwani.partner", "bcd22a76-d4b2-4de0-93b3-f6d13074a802"],
  ["app-captain", "app-captain", "com.bthwani.captain", "7efa39e1-895f-44d7-a597-d613c79297b6"],
];

for (const [key, slug, packageName, easId] of apps) {
  test(`${key} preserves original native and EAS identities without mock APIs`, () => {
    const value = defineBthwaniExpoApp(key, { web: true });
    assert.equal(value.slug, slug);
    assert.equal(value.android.package, packageName);
    assert.equal(value.ios.bundleIdentifier, packageName);
    assert.equal(value.extra.eas.projectId, easId);
    assert.deepEqual(value.platforms, ["ios", "android", "web"]);
    assert.equal(value.updates.url, `https://u.expo.dev/${easId}`);
    assert.equal(value.runtimeVersion.policy, "appVersion");
    assert.ok(value.plugins.includes("expo-router"));
    assert.ok(!value.plugins.some(p => Array.isArray(p) && p[0] === "react-native-maps"));
  });
}

test("native config rejects unadmitted app and unsafe option values", () => {
  assert.throws(() => defineBthwaniExpoApp("app-unknown"), /UNKNOWN_EXPO_SURFACE/);
  assert.throws(() => defineBthwaniExpoApp("app-client", { locationMode: "always" }), /Invalid locationMode/);
  assert.throws(() => defineBthwaniExpoApp("app-partner", { cameraMode: "unknown" }), /Invalid cameraMode/);
});

test("native permissions differ between delivery captain and customer", () => {
  const customer = defineBthwaniExpoApp("app-client", { locationMode: "foreground", cameraMode: "barcode" });
  const captain = defineBthwaniExpoApp("app-captain", { locationMode: "background" });
  assert.ok(customer.android.blockedPermissions.includes("android.permission.WRITE_CONTACTS"));
  assert.ok(!captain.android.blockedPermissions?.includes("android.permission.WRITE_CONTACTS"));
  assert.deepEqual(customer.platforms, ["ios", "android"]);
  assert.deepEqual(captain.platforms, ["ios", "android"]);
});
