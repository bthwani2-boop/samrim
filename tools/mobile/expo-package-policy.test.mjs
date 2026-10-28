import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const base = process.cwd();
const require = createRequire(import.meta.url);
process.env.GOOGLE_MAPS_ANDROID_API_KEY ??= "config-test-only-android";
process.env.GOOGLE_MAPS_IOS_API_KEY ??= "config-test-only-ios";
const { defineSamrimExpoApp } = require("../../tools/mobile/define-samrim-expo-app.cjs");
const sdkVersions = require("../../node_modules/expo/bundledNativeModules.json");

const common = ["expo-calendar", "expo-clipboard", "expo-application", "expo-device"];
const expected = {
  "app-client": ["expo-web-browser", "expo-contacts", "expo-document-picker", "expo-store-review"],
  "app-partner": ["expo-contacts", "expo-document-picker", "expo-print", "expo-store-review", "expo-keep-awake"],
  "app-captain": ["expo-web-browser", "expo-document-picker", "expo-keep-awake"],
};

for (const [app, additions] of Object.entries(expected)) {
  test(`${app} exact Expo 58 package inventory`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(base, "apps", app, "package.json"), "utf8"));
    for (const name of [...common, ...additions]) {
      assert.equal(manifest.dependencies[name], sdkVersions[name].replace(/^[~^]/, ""), `${app}/${name}`);
    }
    assert.equal(manifest.dependencies["expo-screen-capture"], undefined);
  });
  test(`${app} calendar is configured for iOS write-only`, () => {
    const config = defineSamrimExpoApp(app, { ...(app === "app-captain" ? { locationMode: "background", maps: true }
      : app === "app-client" ? { locationMode: "foreground", maps: true, web: true }
      : { cameraMode: "barcode", web: true }) });
    const calendar = config.plugins.find((item) => Array.isArray(item) && item[0] === "expo-calendar");
    assert.ok(calendar);
    assert.equal(calendar[1].writeOnlyAccess, true);
    assert.equal(config.android.blockedPermissions?.includes("android.permission.WRITE_CONTACTS") ?? false,
      ["app-client", "app-partner"].includes(app));
    const contacts = config.plugins.some((item) => Array.isArray(item) && item[0] === "expo-contacts");
    assert.equal(contacts, ["app-client", "app-partner"].includes(app));
    assert.equal(config.platforms.includes("ios"), true);
    assert.equal(config.platforms.includes("android"), true);
  });
}
