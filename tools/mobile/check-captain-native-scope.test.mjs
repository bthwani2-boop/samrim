import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { defineSamrimExpoApp } = require("./define-samrim-expo-app.cjs");
const root = resolve(import.meta.dirname, "../..");
const savedAndroid = process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN;
const savedIos = process.env.GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN;
let captain;
try {
  process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN = "TEST-ONLY-ANDROID-MAP-KEY";
  process.env.GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN = "TEST-ONLY-IOS-MAP-KEY";
  captain = defineSamrimExpoApp("app-captain", { locationMode: "background", maps: true });
} finally {
  if (savedAndroid === undefined) delete process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN;
  else process.env.GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN = savedAndroid;
  if (savedIos === undefined) delete process.env.GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN;
  else process.env.GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN = savedIos;
}
const plugin = (name) => captain.plugins.find((entry) => Array.isArray(entry) && entry[0] === name)?.[1];

test("captain owns background location and foreground service declarations", () => {
  const options = plugin("expo-location");
  assert.ok(options);
  assert.equal(options.isAndroidBackgroundLocationEnabled, true);
  assert.equal(options.isAndroidForegroundServiceEnabled, true);
  assert.equal(options.isIosBackgroundLocationEnabled, true);
  assert.match(options.locationWhenInUsePermission, /[\u0600-\u06ff]/);
  assert.match(options.locationAlwaysAndWhenInUsePermission, /[\u0600-\u06ff]/);
  assert.match(options.locationAlwaysAndWhenInUsePermission, /مهمة/);
});

test("captain deployable identity remains app-owned", () => {
  const stored = JSON.parse(readFileSync(resolve(root, "apps/app-captain/mobile.config.json"), "utf8"));
  assert.equal(captain.android.package, stored.androidPackage);
  assert.equal(captain.ios.bundleIdentifier, stored.iosBundleIdentifier);
  assert.equal(captain.extra.eas.projectId, stored.projectId);
});

test("negative fixture catches missing iOS background permission", () => {
  const missing = { ...plugin("expo-location"), isIosBackgroundLocationEnabled: false };
  assert.notEqual(missing.isIosBackgroundLocationEnabled, true);
});

test("captain microphone and media remain scoped without background recording", () => {
  const audio = plugin("expo-audio");
  const photos = plugin("expo-image-picker");
  assert.ok(audio);
  assert.ok(photos);
  assert.match(audio.microphonePermission, /[\u0600-\u06ff]/);
  assert.match(photos.photosPermission, /[\u0600-\u06ff]/);
  assert.match(photos.cameraPermission, /[\u0600-\u06ff]/);
  assert.equal(audio.recordAudioAndroid, true);
  assert.equal(audio.enableBackgroundRecording, false);
  assert.equal(audio.enableBackgroundPlayback, false);
});
