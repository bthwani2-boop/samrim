import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvedConfigIssues, easBuildIssues, verifyResolvedConfigs } from "./verify-expo-config.mjs";

const manifest = {
  slug: "customer", owner: "bthwani1", scheme: "customer",
  androidPackage: "com.bthwani.customer", iosBundleIdentifier: "com.bthwani.customer", projectId: "project-1",
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
test("accepts centrally owned RTL and registered app IDs", () => {
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
test("catches a customer/merchant web SSR regression", () => {
  const broken = { ...config, web: { output: "static", bundler: "metro" } };
  assert.match(resolvedConfigIssues("customer", manifest, broken).join(" "), /server renderer/);
});

test("real Expo config from all three installed hosts retains app ownership", () => {
  assert.equal(verifyResolvedConfigs(), 3);
});

test("EAS development-only profiles preserve existing credential ownership", () => {
  for (const app of ["customer", "merchant", "captain"]) {
    const file = new URL("../../apps/" + app + "/eas.json", import.meta.url);
    const eas = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(easBuildIssues(app, eas), []);
  }
});

test("EAS cloud profiles reject invalid signing, preview channels and release builds", () => {
  const file = new URL("../../apps/customer/eas.json", import.meta.url);
  const valid = JSON.parse(readFileSync(file, "utf8"));
  const withDevLocal = structuredClone(valid);
  withDevLocal.build.development.credentialsSource = "local";
  assert.match(easBuildIssues("customer", withDevLocal).join(" "), /development credential ownership/);
  const withPreview = structuredClone(valid);
  withPreview.build.internal = { environment: "preview", channel: "preview" };
  assert.match(easBuildIssues("customer", withPreview).join(" "), /unapproved EAS build profile/);
  const wrongChannel = structuredClone(valid);
  wrongChannel.build.development.channel = "preview";
  assert.match(easBuildIssues("customer", wrongChannel).join(" "), /development EAS environment and update channel/);
  const wrongEnvironment = structuredClone(valid);
  wrongEnvironment.build.development.environment = "preview";
  assert.match(easBuildIssues("customer", wrongEnvironment).join(" "), /development EAS environment and update channel/);
  const unapprovedRelease = structuredClone(valid);
  unapprovedRelease.build.production = { distribution: "store" };
  assert.match(easBuildIssues("customer", unapprovedRelease).join(" "), /unapproved EAS build profile/);
  const missingProfile = structuredClone(valid);
  delete missingProfile.build["ios-simulator"];
  assert.match(easBuildIssues("customer", missingProfile).join(" "), /missing stage-4 profile/);
  const reorderedProfiles = structuredClone(valid);
  reorderedProfiles.build = Object.fromEntries(Object.entries(valid.build).reverse());
  assert.deepEqual(easBuildIssues("customer", reorderedProfiles), []);
});

test("Captain development uses current EAS remote signing for its registered new package", () => {
  const file = new URL("../../apps/captain/eas.json", import.meta.url);
  const captain = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(easBuildIssues("captain", captain), []);
  const wrong = structuredClone(captain);
  wrong.build.development.credentialsSource = "local";
  assert.match(easBuildIssues("captain", wrong).join(" "), /development credential ownership/);
});
