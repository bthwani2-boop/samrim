import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { easBuildIssues, resolvedConfigIssues, verifyResolvedConfigs } from "./verify-expo-config.mjs";

const surfaces = ["customer", "merchant", "captain"];
const read = (name, file) => JSON.parse(readFileSync(new URL("../../apps/" + name + "/" + file, import.meta.url), "utf8"));
function resolved(name) {
  const manifest = read(name, "mobile.config.json");
  return { manifest, config: {
    name: manifest.name, version: manifest.version, slug: manifest.slug, owner: manifest.owner, scheme: manifest.scheme,
    platforms: name === "captain" ? ["ios", "android"] : ["ios", "android", "web"],
    android: { package: manifest.androidPackage }, ios: { bundleIdentifier: manifest.iosBundleIdentifier },
    extra: { appKey: manifest.slug, sourceRepo: "samrim", eas: { projectId: manifest.projectId } },
    runtimeVersion: { policy: "appVersion" }, updates: { url: "https://u.expo.dev/" + manifest.projectId },
    ...(name === "captain" ? {} : { web: { bundler: "metro", output: "server" } }),
    plugins: [["expo-localization", {
      supportedLocales: { ios: ["ar"], android: ["ar"] }, forcesRTL: true, allowDynamicLocaleChangesAndroid: false,
    }]],
  } };
}
function rejectsConfig(name, mutate, pattern) {
  const { manifest, config } = resolved(name);
  mutate(config, manifest);
  assert.match(resolvedConfigIssues(name, manifest, config).join(" "), pattern);
}
function rejectsEas(name, mutate, pattern) {
  const config = read(name, "eas.json");
  mutate(config);
  assert.match(easBuildIssues(name, config).join(" "), pattern);
}
function reversed(value) {
  if (Array.isArray(value)) return value.map(reversed);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).reverse().map(([key, entry]) => [key, reversed(entry)]));
  return value;
}

for (const name of surfaces) {
  test(name + " accepts exact registered source and any platform order", () => {
    const { manifest, config } = resolved(name);
    assert.deepEqual(resolvedConfigIssues(name, manifest, config), []);
    config.platforms.reverse();
    assert.deepEqual(resolvedConfigIssues(name, manifest, reversed(config)), []);
  });
  test(name + " accepts actual EAS development profiles independent of all JSON key order", () => {
    const config = read(name, "eas.json");
    assert.deepEqual(easBuildIssues(name, config), []);
    assert.deepEqual(easBuildIssues(name, reversed(config)), []);
  });
}
test("registered identity cannot drift or be replaced by a matching unregistered manifest", () => {
  rejectsConfig("customer", c => { c.ios.bundleIdentifier = "other.app"; }, /iOS identity drift/);
  rejectsConfig("merchant", c => { c.android.package = "other.app"; }, /Android identity drift/);
  rejectsConfig("customer", (c, m) => { c.owner = m.owner = "other-owner"; }, /registered manifest identity drift/);
  rejectsConfig("captain", c => { c.extra.eas.projectId = "other"; }, /EAS project drift/);
  rejectsConfig("customer", c => { c.extra.sourceRepo = "other"; }, /source repository drift/);
});
test("OTA and presentation boundaries reject wrong values, duplicate and non-string platforms", () => {
  rejectsConfig("customer", c => { c.updates.url = "https://u.expo.dev/other"; }, /EAS update project drift/);
  rejectsConfig("merchant", c => { c.runtimeVersion = { policy: "sdkVersion" }; }, /runtime policy drift/);
  rejectsConfig("captain", c => { c.version = "other"; }, /app version drift/);
  rejectsConfig("customer", c => { c.web.output = "static"; }, /server renderer/);
  rejectsConfig("merchant", c => { c.platforms = ["android", "ios"]; }, /unapproved presentation platform/);
  rejectsConfig("captain", c => { c.platforms.push("web"); }, /unapproved presentation platform/);
  rejectsConfig("captain", c => { c.web = { output: "server" }; }, /unapproved Expo Web host/);
  rejectsConfig("customer", c => { c.platforms = ["ios", "ios", "web"]; }, /unapproved presentation platform/);
  rejectsConfig("customer", c => { c.platforms = ["ios", {}, "web"]; }, /unapproved presentation platform/);
  rejectsConfig("merchant", c => { c.runtimeVersion.extra = true; }, /runtime policy drift/);
});
test("localization rejects duplicate, malformed and disabled central RTL", () => {
  rejectsConfig("customer", c => { c.plugins.push(c.plugins[0]); }, /exactly one/);
  rejectsConfig("customer", c => { c.plugins.push("expo-localization"); }, /exactly one/);
  rejectsConfig("customer", c => { c.plugins[0][1].forcesRTL = false; }, /native RTL/);
  rejectsConfig("merchant", c => { c.plugins = {}; }, /invalid plugins list/);
  rejectsConfig("captain", c => { c.plugins[0][1].supportedLocales.ios = ["en"]; }, /iOS Arabic/);
});
test("localization admission rejects extra tuple elements and unsupported option fields", () => {
  rejectsConfig("customer", c => { c.plugins[0].push("unexpected"); }, /invalid localization plugin tuple/);
  rejectsConfig("merchant", c => { c.plugins[0][1].supportsRTL = false; }, /unapproved localization options/);
  rejectsConfig("captain", c => { c.plugins[0][1].supportedLocales.web = ["en"]; }, /unapproved localization options/);
  rejectsConfig("customer", c => { c.plugins[0][1].supportedLocales.android = ["ar", "ar"]; }, /Android Arabic/);
});
test("EAS profile names, signing, release and channel boundaries fail closed", () => {
  rejectsEas("customer", c => { c.build.development.credentialsSource = "local"; }, /development credential ownership/);
  rejectsEas("captain", c => { c.build.development.credentialsSource = "local"; }, /development credential ownership/);
  rejectsEas("customer", c => { c.build.internal = { channel: "preview" }; }, /unapproved EAS build profile/);
  rejectsEas("customer", c => { c.build.production = { distribution: "store" }; }, /unapproved EAS build profile/);
  rejectsEas("customer", c => { delete c.build["ios-simulator"]; }, /missing development profile/);
  rejectsEas("customer", c => { c.build.development.channel = "preview"; }, /development EAS environment and update channel/);
  rejectsEas("customer", c => { c.build.development.environment = "preview"; }, /development EAS environment and update channel/);
  rejectsEas("merchant", c => { c.submit = { production: {} }; }, /unapproved EAS top-level/);
});
test("EAS rejects overrides inside every admitted profile and exact type coercion", () => {
  rejectsEas("customer", c => { c.build.base.env.BTHWANI_ENFORCE_NATIVE_KEYS = "0"; }, /unapproved EAS base environment/);
  rejectsEas("merchant", c => { c.build.development.node = "1.0.0"; }, /unapproved development profile override/);
  rejectsEas("customer", c => { c.build.development.android.credentialsSource = "local"; }, /internally installable APK/);
  rejectsEas("captain", c => { c.build["ios-simulator"].channel = "production"; }, /simulator must inherit development/);
  rejectsEas("captain", c => { c.build["ios-simulator"].ios.credentialsSource = "local"; }, /simulator must inherit development/);
  rejectsEas("merchant", c => { c.build.base.pnpm = "1.0.0"; }, /remote toolchain mismatch/);
  rejectsEas("customer", c => { c.cli.requireCommit = "true"; }, /safe build settings drift/);
  rejectsEas("merchant", c => { c.build.development.developmentClient = 1; }, /development client/);
  rejectsEas("captain", c => { c.build["ios-simulator"].ios.simulator = "true"; }, /simulator must inherit development/);
});
test("malformed config is rejected with non-secret diagnostics", () => {
  const { manifest } = resolved("customer");
  assert.match(resolvedConfigIssues("customer", manifest, null).join(" "), /invalid resolved/);
  assert.match(easBuildIssues("customer", null).join(" "), /invalid EAS/);
  rejectsEas("merchant", c => { c.build.base = null; }, /remote toolchain mismatch/);
  rejectsEas("customer", c => { c.build.development = null; }, /unapproved development profile override/);
});
test("real installed Expo CLI resolves all three source configurations", () => {
  assert.equal(verifyResolvedConfigs(), 3);
});
