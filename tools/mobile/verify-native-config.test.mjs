import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("remote Android build fails closed for missing maps/Firebase or mismatched Firebase app", () => {
  const folder = mkdtempSync(join(tmpdir(), "bthwani-eas-synthetic-"));
  const names = [
    "EAS_BUILD", "EAS_BUILD_PLATFORM", "BTHWANI_SECRETS_ROOT",
    "GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", "GOOGLE_MAPS_ANDROID_API_KEY",
    "GOOGLE_MAPS_IOS_API_KEY", "GOOGLE_SERVICES_JSON", "BTHWANI_ENFORCE_NATIVE_KEYS",
  ];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.BTHWANI_SECRETS_ROOT = folder;
    assert.throws(
      () => defineBthwaniExpoApp("app-client", { maps: true, locationMode: "foreground" }),
      /Missing approved Google Maps API keys/
    );
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT = "synthetic-android-key";
    process.env.GOOGLE_MAPS_IOS_API_KEY = "synthetic-ios-key";
    assert.throws(
      () => defineBthwaniExpoApp("app-client", { maps: true, locationMode: "foreground" }),
      /Missing GOOGLE_SERVICES_JSON EAS file secret/
    );
    const file = join(folder, "synthetic-google-services.json");
    process.env.GOOGLE_SERVICES_JSON = file;
    writeFileSync(file, "{invalid-json", "utf8");
    assert.throws(
      () => defineBthwaniExpoApp("app-client", { maps: true, locationMode: "foreground" }),
      /Invalid GOOGLE_SERVICES_JSON/
    );
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.other.app"}}}]}));
    assert.throws(
      () => defineBthwaniExpoApp("app-client", { maps: true, locationMode: "foreground" }),
      /GOOGLE_SERVICES_JSON Android package mismatch/
    );
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.bthwani.client"}}}]}));
    const config = defineBthwaniExpoApp("app-client", { maps: true, locationMode: "foreground" });
    assert.equal(config.android.googleServicesFile, file);
    assert.ok(config.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === "react-native-maps"));
  } finally {
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});

test("merchant cloud native config rejects Customer Firebase package and accepts its own", () => {
  const folder = mkdtempSync(join(tmpdir(), "bthwani-merchant-eas-synthetic-"));
  const names = ["EAS_BUILD", "EAS_BUILD_PLATFORM", "BTHWANI_SECRETS_ROOT",
    "GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER", "GOOGLE_MAPS_ANDROID_API_KEY",
    "GOOGLE_MAPS_IOS_API_KEY", "GOOGLE_SERVICES_JSON"];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.BTHWANI_SECRETS_ROOT = folder;
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER = "synthetic-partner-android";
    process.env.GOOGLE_MAPS_IOS_API_KEY = "synthetic-partner-ios";
    const file = join(folder, "synthetic-merchant-firebase.json");
    process.env.GOOGLE_SERVICES_JSON = file;
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.bthwani.client"}}}]}));
    assert.throws(() => defineBthwaniExpoApp("app-partner", { maps: true, cameraMode: "barcode" }),
      /GOOGLE_SERVICES_JSON Android package mismatch/);
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.bthwani.partner"}}}]}));
    const config = defineBthwaniExpoApp("app-partner", { maps: true, cameraMode: "barcode" });
    assert.equal(config.android.googleServicesFile, file);
    assert.equal(config.android.package, "com.bthwani.partner");
    assert.ok(config.plugins.some(p => Array.isArray(p) && p[0] === "react-native-maps"));
  } finally {
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
