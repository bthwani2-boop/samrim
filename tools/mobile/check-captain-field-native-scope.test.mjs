import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { defineSamrimExpoApp } = require("./define-samrim-expo-app.cjs");
const root = resolve(import.meta.dirname, "../..");
const vars = [
  "GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN", "GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN",
  "GOOGLE_MAPS_ANDROID_API_KEY_APP_FIELD", "GOOGLE_MAPS_IOS_API_KEY",
];
const saved = Object.fromEntries(vars.map((name) => [name, process.env[name]]));
let captain, field;
try {
  for (const name of vars) process.env[name] = "W032-LOCAL-NATIVE-CONFIG-PLACEHOLDER";
  captain = defineSamrimExpoApp("app-captain", { locationMode: "background", maps: true });
  field = defineSamrimExpoApp("app-field", { cameraMode: "barcode", locationMode: "foreground", maps: true });
} finally {
  for (const name of vars) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
}

function locationOptions(config) {
  const found = config.plugins.filter((item) => Array.isArray(item) && item[0] === "expo-location");
  assert.equal(found.length, 1);
  return found[0][1];
}

test("captain is the only owner of background location and foreground service declarations", () => {
  const opts = locationOptions(captain);
  assert.equal(opts.isAndroidBackgroundLocationEnabled, true);
  assert.equal(opts.isAndroidForegroundServiceEnabled, true);
  assert.equal(opts.isIosBackgroundLocationEnabled, true);
  assert.match(opts.locationWhenInUsePermission, /[\u0600-\u06ff]/);
  assert.match(opts.locationAlwaysAndWhenInUsePermission, /[\u0600-\u06ff]/);
  assert.match(opts.locationAlwaysAndWhenInUsePermission, /مهمة/);
});

test("field must not acquire background location on Android or iOS", () => {
  const opts = locationOptions(field);
  assert.equal(opts.isAndroidBackgroundLocationEnabled, undefined);
  assert.equal(opts.isAndroidForegroundServiceEnabled, undefined);
  assert.equal(opts.isIosBackgroundLocationEnabled, undefined);
  assert.equal(opts.locationAlwaysAndWhenInUsePermission, undefined);
  assert.equal(field.plugins.some((item) => Array.isArray(item) && item[0] === "expo-audio"), false);
});

test("device identities come from separate app-owned mobile configs", () => {
  for (const [name, cfg] of [["app-captain", captain], ["app-field", field]]) {
    const stored = JSON.parse(readFileSync(resolve(root, "apps", name, "mobile.config.json"), "utf8"));
    assert.equal(cfg.android.package, stored.androidPackage);
    assert.equal(cfg.ios.bundleIdentifier, stored.iosBundleIdentifier);
    assert.equal(cfg.extra.eas.projectId, stored.projectId);
  }
  assert.notEqual(captain.android.package, field.android.package);
});

test("negative fixture catches missing iOS background permission", () => {
  const missing = { ...locationOptions(captain), isIosBackgroundLocationEnabled: false };
  assert.equal(missing.isAndroidBackgroundLocationEnabled, true);
  assert.notEqual(missing.isIosBackgroundLocationEnabled, true);
});
