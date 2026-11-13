import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvedConfigIssues, easBuildIssues, verifyResolvedConfigs } from "./verify-expo-config.mjs";

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

test("real Expo config from all three installed hosts retains app ownership", () => {
  assert.equal(verifyResolvedConfigs(), 3);
});

test("EAS development/internal remote profiles preserve signing ownership and safe preview channels", () => {
  for (const app of ["customer", "merchant"]) {
    const file = new URL("../../apps/" + app + "/eas.json", import.meta.url);
    const eas = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(easBuildIssues(app, eas), []);
  }
});

test("EAS cloud profiles reject missing remote signing, wrong channels and store release", () => {
  const file = new URL("../../apps/customer/eas.json", import.meta.url);
  const valid = JSON.parse(readFileSync(file, "utf8"));
  const withDevLocal = structuredClone(valid);
  withDevLocal.build.development.credentialsSource = "local";
  assert.match(easBuildIssues("customer", withDevLocal).join(" "), /missing local credentials/);
  const withInternalLocal = structuredClone(valid);
  withInternalLocal.build.internal.credentialsSource = "local";
  assert.match(easBuildIssues("customer", withInternalLocal).join(" "), /missing local credentials/);
  const wrongChannel = structuredClone(valid);
  wrongChannel.build.internal.channel = "production";
  assert.match(easBuildIssues("customer", wrongChannel).join(" "), /wrong EAS Update channel/);
  const unapprovedRelease = structuredClone(valid);
  unapprovedRelease.build.production = { distribution: "store" };
  assert.match(easBuildIssues("customer", unapprovedRelease).join(" "), /unapproved EAS build profile/);
});
