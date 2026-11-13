import assert from "node:assert/strict";
import test from "node:test";
import { resolvedConfigIssues } from "./verify-expo-config.mjs";

const manifest = {
  slug: "app-client", owner: "bthwani1", scheme: "client",
  androidPackage: "com.bthwani.client", iosBundleIdentifier: "com.bthwani.client", projectId: "project-1",
};
const config = {
  slug: manifest.slug, owner: manifest.owner, scheme: manifest.scheme,
  android: { package: manifest.androidPackage },
  ios: { bundleIdentifier: manifest.iosBundleIdentifier },
  extra: { eas: { projectId: manifest.projectId } },
  web: { bundler: "metro", output: "server" },
  plugins: [["expo-localization", {
    supportedLocales: { ios: ["ar"], android: ["ar"] },
    forcesRTL: true, allowDynamicLocaleChangesAndroid: false,
  }]],
};
test("accepts centrally owned RTL and preserved app IDs", () => {
  assert.deepEqual(resolvedConfigIssues("customer", manifest, config), []);
});
test("catches app identifier drift", () => {
  const broken = { ...config, ios: { bundleIdentifier: "different.app" } };
  assert.match(resolvedConfigIssues("customer", manifest, broken).join(" "), /iOS identity drift/);
});
test("catches duplicate localization and disabled RTL", () => {
  const broken = { ...config, plugins: [config.plugins[0], config.plugins[0]] };
  assert.match(resolvedConfigIssues("customer", manifest, broken).join(" "), /exactly one/);
  const mixed = { ...config, plugins: [config.plugins[0], "expo-localization"] };
  assert.match(resolvedConfigIssues("customer", manifest, mixed).join(" "), /exactly one/);
  const disabled = { ...config, plugins: [["expo-localization", {
    ...config.plugins[0][1], forcesRTL: false,
  }]] };
  assert.match(resolvedConfigIssues("customer", manifest, disabled).join(" "), /native RTL/);
});
test("catches a client/merchant web SSR regression", () => {
  const broken = { ...config, web: { output: "static", bundler: "metro" } };
  assert.match(resolvedConfigIssues("customer", manifest, broken).join(" "), /server renderer/);
});
