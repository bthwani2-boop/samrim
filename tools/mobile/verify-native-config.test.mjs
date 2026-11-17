import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const { defineBthwaniExpoApp } = require("./define-bthwani-expo-app.cjs");

const apps = [
  ["customer", "customer", "com.bthwani.customer", "9b97c906-0dfc-4cf7-8d2b-079593523dc7"],
  ["merchant", "merchant", "com.bthwani.merchant", "c56092bf-d41b-4944-a28c-de227b3d8e8a"],
  ["app-captain", "app-captain", "com.bthwani.captain", "7efa39e1-895f-44d7-a597-d613c79297b6"],
];

for (const [key, slug, packageName, easId] of apps) {
  test(`${key} uses its registered native and EAS identity without mock APIs`, () => {
    const value = defineBthwaniExpoApp(key, { web: true });
    assert.equal(value.slug, slug);
    assert.equal(value.android.package, packageName);
    assert.equal(value.ios.bundleIdentifier, packageName);
    assert.equal(value.extra.eas.projectId, easId);
    assert.equal(value.extra.sourceRepo, "samrim");
    assert.deepEqual(value.platforms, ["ios", "android", "web"]);
    assert.equal(value.updates.url, `https://u.expo.dev/${easId}`);
    assert.equal(value.runtimeVersion.policy, "appVersion");
    assert.ok(value.plugins.includes("expo-router"));
    for (const plugin of ["expo-asset", "expo-font", "expo-image", "expo-status-bar", "expo-video"]) {
      assert.ok(value.plugins.includes(plugin), key + " missing SDK58 config plugin " + plugin);
    }
    assert.ok(!value.plugins.some(p => Array.isArray(p) && p[0] === "react-native-maps"));
  });
}

test("native config rejects unadmitted app and unsafe option values", () => {
  assert.throws(() => defineBthwaniExpoApp("app-unknown"), /UNKNOWN_EXPO_SURFACE/);
  assert.throws(() => defineBthwaniExpoApp("app-client"), /UNKNOWN_EXPO_SURFACE/);
  assert.throws(() => defineBthwaniExpoApp("app-partner"), /UNKNOWN_EXPO_SURFACE/);
  assert.throws(() => defineBthwaniExpoApp("customer", { locationMode: "always" }), /Invalid locationMode/);
  assert.throws(() => defineBthwaniExpoApp("merchant", { cameraMode: "unknown" }), /Invalid cameraMode/);
});

test("native permissions differ between delivery captain and customer", () => {
  const customer = defineBthwaniExpoApp("customer", { locationMode: "foreground", cameraMode: "barcode" });
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
    "GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER", "GOOGLE_MAPS_ANDROID_API_KEY",
    "GOOGLE_MAPS_IOS_API_KEY_MERCHANT", "GOOGLE_SERVICES_JSON", "BTHWANI_ENFORCE_NATIVE_KEYS",
  ];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.BTHWANI_SECRETS_ROOT = folder;
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
      /Missing approved Google Maps API keys/
    );
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER = "synthetic-android-key";
    process.env.GOOGLE_MAPS_IOS_API_KEY_CUSTOMER = "synthetic-ios-key";
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
      /Missing GOOGLE_SERVICES_JSON EAS file secret/
    );
    const directory = join(folder, "firebase-directory-not-file");
    mkdirSync(directory);
    process.env.GOOGLE_SERVICES_JSON = directory;
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
      error => error.message === "Missing GOOGLE_SERVICES_JSON EAS file secret for customer"
    );
    const file = join(folder, "synthetic-google-services.json");
    process.env.GOOGLE_SERVICES_JSON = file;
    writeFileSync(file, "{invalid-json", "utf8");
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
      /Invalid GOOGLE_SERVICES_JSON/
    );
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.other.app"}}}]}));
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
      /GOOGLE_SERVICES_JSON Android package mismatch/
    );
    writeFileSync(file, JSON.stringify({
      project_info: { project_id: "bthwani-platform", project_number: "663095381335" },
      client: [{client_info: {android_client_info: {package_name: "com.bthwani.customer"}}}],
    }));
    const config = defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" });
    assert.equal(config.android.googleServicesFile, file);
    assert.ok(config.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === "react-native-maps"));
    for (const wrongProject of [
      { project_id: "not-bthwani-platform", project_number: "663095381335" },
      { project_id: "bthwani-platform", project_number: "111111111111" },
    ]) {
      writeFileSync(file, JSON.stringify({
        project_info: wrongProject,
        client: [{ client_info: { android_client_info: { package_name: "com.bthwani.customer" } } }],
      }));
      assert.throws(
        () => defineBthwaniExpoApp("customer", { maps: true, locationMode: "foreground" }),
        /GOOGLE_SERVICES_JSON Firebase project mismatch/,
      );
    }
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
    "GOOGLE_MAPS_ANDROID_API_KEY_MERCHANT", "GOOGLE_MAPS_ANDROID_API_KEY",
    "GOOGLE_MAPS_IOS_API_KEY_MERCHANT", "GOOGLE_SERVICES_JSON"];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.BTHWANI_SECRETS_ROOT = folder;
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_MERCHANT = "synthetic-merchant-android";
    process.env.GOOGLE_MAPS_IOS_API_KEY_MERCHANT = "synthetic-merchant-ios";
    const file = join(folder, "synthetic-merchant-firebase.json");
    process.env.GOOGLE_SERVICES_JSON = file;
    writeFileSync(file, JSON.stringify({client: [{client_info: {android_client_info: {package_name: "com.bthwani.customer"}}}]}));
    assert.throws(() => defineBthwaniExpoApp("merchant", { maps: true, cameraMode: "barcode" }),
      /GOOGLE_SERVICES_JSON Android package mismatch/);
    writeFileSync(file, JSON.stringify({
      project_info: { project_id: "bthwani-platform", project_number: "663095381335" },
      client: [{client_info: {android_client_info: {package_name: "com.bthwani.merchant"}}}],
    }));
    const config = defineBthwaniExpoApp("merchant", { maps: true, cameraMode: "barcode" });
    assert.equal(config.android.googleServicesFile, file);
    assert.equal(config.android.package, "com.bthwani.merchant");
    assert.ok(config.plugins.some(p => Array.isArray(p) && p[0] === "react-native-maps"));
  } finally {
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});


test("EAS Firebase validation cannot swap the verified file path before its read", { concurrency: false }, () => {
  const folder = mkdtempSync(join(tmpdir(), "bthwani-eas-race-synthetic-"));
  const file = join(folder, "google-services.json");
  const names = ["EAS_BUILD", "EAS_BUILD_PLATFORM", "GOOGLE_SERVICES_JSON"];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const realStatSync = fs.statSync;
  const realFstatSync = fs.fstatSync;
  const realReadFileSync = fs.readFileSync;
  let verifiedFd;
  let readFd;
  let swapped = false;
  try {
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.GOOGLE_SERVICES_JSON = file;
    writeFileSync(file, JSON.stringify({
      project_info: { project_id: "bthwani-platform", project_number: "663095381335" },
      client: [
        { client_info: { android_client_info: { package_name: "com.bthwani.customer" } } },
      ],
    }));
    // An attacker can replace a path between stat(path) and readFile(path).
    // A correct implementation opens once, validates the open descriptor, then reads it.
    fs.statSync = (candidate, ...args) => {
      const stat = realStatSync(candidate, ...args);
      if (String(candidate) === file && !swapped) {
        fs.renameSync(file, join(folder, "original.json"));
        writeFileSync(file, JSON.stringify({ client: [
          { client_info: { android_client_info: { package_name: "com.other.app" } } },
        ] }));
        swapped = true;
      }
      return stat;
    };
    fs.fstatSync = (fd, ...args) => {
      verifiedFd = fd;
      return realFstatSync(fd, ...args);
    };
    fs.readFileSync = (source, ...args) => {
      if (typeof source === "number") readFd = source;
      return realReadFileSync(source, ...args);
    };
    const config = defineBthwaniExpoApp("customer");
    assert.equal(config.android.googleServicesFile, file);
    assert.equal(swapped, false, "the Firebase path must not be stat-checked before opening");
    assert.equal(typeof verifiedFd, "number");
    assert.equal(readFd, verifiedFd, "the validated descriptor must also be the descriptor read");
  } finally {
    fs.statSync = realStatSync;
    fs.fstatSync = realFstatSync;
    fs.readFileSync = realReadFileSync;
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});


test("Maps config requires explicit opt-in to mobile.env and rejects missing keys for native builds", () => {
  const dir = mkdtempSync(join(tmpdir(), "bthwani-maps-explicit-root-"));
  const names = [
    "BTHWANI_SECRETS_ROOT", "GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER",
    "GOOGLE_MAPS_ANDROID_API_KEY", "GOOGLE_MAPS_IOS_API_KEY_CUSTOMER",
    "EAS_BUILD", "BTHWANI_ENFORCE_NATIVE_KEYS",
  ];
  const originals = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const absent = defineBthwaniExpoApp("customer", { maps: true });
    assert.ok(!absent.plugins.some(p => Array.isArray(p) && p[0] === "react-native-maps"));
    process.env.BTHWANI_ENFORCE_NATIVE_KEYS = "1";
    assert.throws(
      () => defineBthwaniExpoApp("customer", { maps: true }),
      /Missing approved Google Maps API keys/
    );
    process.env.BTHWANI_ENFORCE_NATIVE_KEYS = "0";
    mkdirSync(join(dir, "env"));
    writeFileSync(
      join(dir, "env", "mobile.env"),
      "GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER=synthetic-android\nGOOGLE_MAPS_IOS_API_KEY_CUSTOMER=synthetic-ios\n",
      "utf8"
    );
    process.env.BTHWANI_SECRETS_ROOT = dir;
    const explicit = defineBthwaniExpoApp("customer", { maps: true });
    const maps = explicit.plugins.find(p => Array.isArray(p) && p[0] === "react-native-maps");
    assert.ok(maps, "approved explicit root must activate the maps plugin");
    assert.equal(maps[1].androidGoogleMapsApiKey, "synthetic-android");
    assert.equal(maps[1].iosGoogleMapsApiKey, "synthetic-ios");
  } finally {
    for (const name of names) {
      if (originals[name] === undefined) delete process.env[name];
      else process.env[name] = originals[name];
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new Customer and Merchant require package-specific Maps keys instead of donor or shared keys", () => {
  const names = [
    "BTHWANI_SECRETS_ROOT", "BTHWANI_ENFORCE_NATIVE_KEYS", "EAS_BUILD",
    "GOOGLE_MAPS_ANDROID_API_KEY", "GOOGLE_MAPS_IOS_API_KEY",
    "GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", "GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER",
    "GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER", "GOOGLE_MAPS_IOS_API_KEY_CUSTOMER",
    "GOOGLE_MAPS_ANDROID_API_KEY_MERCHANT", "GOOGLE_MAPS_IOS_API_KEY_MERCHANT",
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.BTHWANI_ENFORCE_NATIVE_KEYS = "1";
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = "donor-shared-android";
    process.env.GOOGLE_MAPS_IOS_API_KEY = "donor-shared-ios";
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT = "donor-customer-android";
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER = "donor-merchant-android";
    for (const appKey of ["customer", "merchant"]) {
      assert.throws(() => defineBthwaniExpoApp(appKey, { maps: true }),
        /Missing approved Google Maps API keys/);
    }
    for (const appKey of ["customer", "merchant"]) {
      process.env[`GOOGLE_MAPS_ANDROID_API_KEY_${appKey.toUpperCase()}`] = "new-android";
      process.env[`GOOGLE_MAPS_IOS_API_KEY_${appKey.toUpperCase()}`] = "new-ios";
      const config = defineBthwaniExpoApp(appKey, { maps: true });
      const maps = config.plugins.find(p => Array.isArray(p) && p[0] === "react-native-maps");
      assert.equal(maps?.[1].androidGoogleMapsApiKey, "new-android");
      assert.equal(maps?.[1].iosGoogleMapsApiKey, "new-ios");
    }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("native maps keys are scoped to the EAS platform, not required for another platform", { concurrency: false }, () => {
  const folder = mkdtempSync(join(tmpdir(), "bthwani-platform-maps-synthetic-"));
  const file = join(folder, "firebase-android.json");
  const names = ["EAS_BUILD", "EAS_BUILD_PLATFORM", "BTHWANI_ENFORCE_NATIVE_KEYS",
    "GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER", "GOOGLE_MAPS_IOS_API_KEY_CUSTOMER", "GOOGLE_SERVICES_JSON"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.EAS_BUILD = "true";
    process.env.EAS_BUILD_PLATFORM = "android";
    process.env.GOOGLE_MAPS_IOS_API_KEY_CUSTOMER = "synthetic-ios-only";
    assert.throws(() => defineBthwaniExpoApp("customer", { maps: true }),
      /Missing approved Google Maps API keys/);
    process.env.GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER = "synthetic-android-only";
    delete process.env.GOOGLE_MAPS_IOS_API_KEY_CUSTOMER;
    writeFileSync(file, JSON.stringify({
      project_info: { project_id: "bthwani-platform", project_number: "663095381335" },
      client: [{ client_info: { android_client_info: { package_name: "com.bthwani.customer" } } }],
    }));
    process.env.GOOGLE_SERVICES_JSON = file;
    const android = defineBthwaniExpoApp("customer", { maps: true });
    const androidMaps = android.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === "react-native-maps");
    assert.equal(androidMaps[1].androidGoogleMapsApiKey, "synthetic-android-only");
    assert.equal(androidMaps[1].iosGoogleMapsApiKey, undefined);
    process.env.EAS_BUILD_PLATFORM = "ios";
    delete process.env.GOOGLE_MAPS_ANDROID_API_KEY_CUSTOMER;
    assert.throws(() => defineBthwaniExpoApp("customer", { maps: true }),
      /Missing approved Google Maps API keys/);
    process.env.GOOGLE_MAPS_IOS_API_KEY_CUSTOMER = "synthetic-ios-only";
    const ios = defineBthwaniExpoApp("customer", { maps: true });
    const iosMaps = ios.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === "react-native-maps");
    assert.equal(iosMaps[1].iosGoogleMapsApiKey, "synthetic-ios-only");
    assert.equal(iosMaps[1].androidGoogleMapsApiKey, undefined);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});