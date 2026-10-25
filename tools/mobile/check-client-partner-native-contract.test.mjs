import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { defineSamrimExpoApp } = require("./define-samrim-expo-app.cjs");
const root = resolve(import.meta.dirname, "../..");
const apps = ["app-client", "app-partner"];

function withoutNativeBuild(callback) {
  const names = ["GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", "GOOGLE_MAPS_IOS_API_KEY"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = "W031-LOCAL-INTROSPECT-PLACEHOLDER";
    return callback();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

const configurations = withoutNativeBuild(() => ({
  "app-client": defineSamrimExpoApp("app-client", { locationMode: "foreground", maps: true, web: true }),
  "app-partner": defineSamrimExpoApp("app-partner", { cameraMode: "barcode", web: true }),
}));

function plugin(config, name) {
  const found = config.plugins.filter((item) => (Array.isArray(item) ? item[0] : item) === name);
  assert.equal(found.length, 1, config.slug + " must own exactly one " + name + " native plugin");
  return Array.isArray(found[0]) ? found[0][1] : {};
}

for (const app of apps) {
  test(app + ": deployable identity matches its only app-owned mobile.config.json", () => {
    const config = configurations[app];
    const data = JSON.parse(readFileSync(resolve(root, "apps", app, "mobile.config.json"), "utf8"));
    const eas = JSON.parse(readFileSync(resolve(root, "apps", app, "eas.json"), "utf8"));
    assert.equal(config.slug, data.slug);
    assert.equal(config.android.package, data.androidPackage);
    assert.equal(config.ios.bundleIdentifier, data.iosBundleIdentifier);
    assert.equal(config.extra.eas.projectId, data.projectId);
    assert.equal(config.updates.url, "https://u.expo.dev/" + data.projectId);
    assert.deepEqual(config.runtimeVersion, { policy: "appVersion" });
    assert.equal(eas.build.development.android.buildType, "apk");
    assert.equal(eas.build.development.developmentClient, true);
    assert.equal(eas.build["ios-simulator"].ios.simulator, true);
    assert.equal(eas.cli.requireCommit, true);
  });

  test(app + ": Arabic camera, photos and microphone descriptions", () => {
    const config = configurations[app];
    const images = plugin(config, "expo-image-picker");
    const audio = plugin(config, "expo-audio");
    assert.match(images.photosPermission, /[\u0600-\u06ff]/);
    assert.match(images.cameraPermission, /[\u0600-\u06ff]/);
    assert.match(images.microphonePermission, /[\u0600-\u06ff]/);
    assert.match(audio.microphonePermission, /[\u0600-\u06ff]/);
    assert.equal(audio.recordAudioAndroid, true);
    assert.equal(audio.enableBackgroundRecording, false);
    assert.equal(audio.enableBackgroundPlayback, false);
    assert.ok(plugin(config, "expo-notifications").sounds.length >= 3);
  });
}

test("client foreground location cannot enable background GPS services", () => {
  const client = configurations["app-client"];
  const options = plugin(client, "expo-location");
  assert.equal(options.isAndroidBackgroundLocationEnabled, undefined);
  assert.equal(options.isAndroidForegroundServiceEnabled, undefined);
  assert.match(options.locationWhenInUsePermission, /[\u0600-\u06ff]/);
});

test("partner barcode scanner never blocks the separate voice recording permission", () => {
  const partner = configurations["app-partner"];
  const camera = plugin(partner, "expo-camera");
  assert.equal(camera.recordAudioAndroid, false);
  assert.notEqual(camera.microphonePermission, false);
  assert.equal(camera.barcodeScannerEnabled, true);
  assert.equal(partner.plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === "expo-location"), false);
});

test("client and partner deployable identities are separate", () => {
  const client = configurations["app-client"];
  const partner = configurations["app-partner"];
  for (const [a, b] of [
    [client.android.package, partner.android.package],
    [client.ios.bundleIdentifier, partner.ios.bundleIdentifier],
    [client.extra.eas.projectId, partner.extra.eas.projectId],
    [client.scheme, partner.scheme],
  ]) assert.notEqual(a, b);
});
