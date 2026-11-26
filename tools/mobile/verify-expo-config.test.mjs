import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvedConfigIssues, easBuildIssues, verifyResolvedConfigs } from "./verify-expo-config.mjs";

const surfaces = ["customer","merchant","captain"];
const read = (name,file) => JSON.parse(readFileSync(new URL("../../apps/" + name + "/" + file,import.meta.url),"utf8"));
function configFor(name) {
  const manifest = read(name,"mobile.config.json");
  const config = {
    name:manifest.name, version:manifest.version, slug:manifest.slug, owner:manifest.owner, scheme:manifest.scheme,
    platforms:name === "captain" ? ["ios","android"] : ["ios","android","web"],
    android:{package:manifest.androidPackage},
    ios:{bundleIdentifier:manifest.iosBundleIdentifier},
    extra:{appKey:manifest.slug,sourceRepo:"samrim",eas:{projectId:manifest.projectId}},
    runtimeVersion:{policy:"appVersion"},
    updates:{url:"https://u.expo.dev/" + manifest.projectId},
    ...(name === "captain" ? {} : {web:{bundler:"metro",output:"server"}}),
    plugins:[["expo-localization",{
      supportedLocales:{ios:["ar"],android:["ar"]},forcesRTL:true,allowDynamicLocaleChangesAndroid:false,
    }]],
  };
  return {manifest,config};
}
function rejectsConfig(name,mutate,pattern) {
  const {manifest,config} = configFor(name);
  mutate(config,manifest);
  assert.match(resolvedConfigIssues(name,manifest,config).join(" "),pattern);
}
function rejectsEas(name,mutate,pattern) {
  const config = read(name,"eas.json");
  mutate(config);
  assert.match(easBuildIssues(name,config).join(" "),pattern);
}

for (const name of surfaces) {
  test(name + " admits its registered Expo identity and centrally owned RTL",() => {
    const {manifest,config} = configFor(name);
    assert.deepEqual(resolvedConfigIssues(name,manifest,config),[]);
  });
  test(name + " admits its actual development-only EAS profiles in any key order",() => {
    const config = read(name,"eas.json");
    assert.deepEqual(easBuildIssues(name,config),[]);
    config.build = Object.fromEntries(Object.entries(config.build).reverse());
    assert.deepEqual(easBuildIssues(name,config),[]);
  });
}

test("resolved identity rejects drift and a matching but unregistered manifest",() => {
  rejectsConfig("customer",c => { c.ios.bundleIdentifier = "other.app"; },/iOS identity drift/);
  rejectsConfig("merchant",c => { c.android.package = "other.app"; },/Android identity drift/);
  rejectsConfig("customer", (c,m) => { c.owner = m.owner = "other-owner"; },/registered manifest identity drift/);
  rejectsConfig("captain", c => { c.extra.eas.projectId = "other"; },/EAS project drift/);
  rejectsConfig("customer", c => { c.extra.sourceRepo = "other"; },/source repository drift/);
});
test("resolved OTA target and runtime policy must retain the registered identity",() => {
  rejectsConfig("customer", c => { c.updates.url = "https://u.expo.dev/other"; },/EAS update project drift/);
  rejectsConfig("merchant", c => { c.runtimeVersion = {policy:"sdkVersion"}; },/runtime policy drift/);
  rejectsConfig("captain", c => { c.version = "other"; },/app version drift/);
});
test("resolved platform and SSR boundaries reject missing or unapproved hosts",() => {
  rejectsConfig("customer",c => { c.web.output = "static"; },/server renderer/);
  rejectsConfig("merchant",c => { c.platforms = ["android","ios"]; },/unapproved presentation platform/);
  rejectsConfig("captain",c => { c.platforms.push("web"); },/unapproved presentation platform/);
  rejectsConfig("captain",c => { c.web = {output:"server"}; },/unapproved Expo Web host/);
});
test("localization rejects duplicate, malformed and disabled central RTL",() => {
  rejectsConfig("customer",c => { c.plugins.push(c.plugins[0]); },/exactly one/);
  rejectsConfig("customer",c => { c.plugins.push("expo-localization"); },/exactly one/);
  rejectsConfig("customer",c => { c.plugins[0][1].forcesRTL = false; },/native RTL/);
  rejectsConfig("merchant",c => { c.plugins = {}; },/invalid plugins list/);
  rejectsConfig("captain",c => { c.plugins[0][1].supportedLocales.ios = ["en"]; },/iOS Arabic/);
});
test("EAS profile names, signing, release and channel boundaries fail closed",() => {
  rejectsEas("customer",c => { c.build.development.credentialsSource = "local"; },/development credential ownership/);
  rejectsEas("captain",c => { c.build.development.credentialsSource = "local"; },/development credential ownership/);
  rejectsEas("customer",c => { c.build.internal = {channel:"preview"}; },/unapproved EAS build profile/);
  rejectsEas("customer",c => { c.build.production = {distribution:"store"}; },/unapproved EAS build profile/);
  rejectsEas("customer",c => { delete c.build["ios-simulator"]; },/missing development profile/);
  rejectsEas("customer",c => { c.build.development.channel = "preview"; },/development EAS environment and update channel/);
  rejectsEas("customer",c => { c.build.development.environment = "preview"; },/development EAS environment and update channel/);
  rejectsEas("merchant",c => { c.submit = {production:{}}; },/unapproved EAS top-level/);
});
test("EAS rejects overrides inside already admitted profile names",() => {
  rejectsEas("customer",c => { c.build.base.env.BTHWANI_ENFORCE_NATIVE_KEYS = "0"; },/unapproved EAS base environment/);
  rejectsEas("merchant",c => { c.build.development.node = "1.0.0"; },/unapproved development profile override/);
  rejectsEas("customer",c => { c.build.development.android.credentialsSource = "local"; },/internally installable APK/);
  rejectsEas("captain",c => { c.build["ios-simulator"].channel = "production"; },/simulator must inherit development/);
  rejectsEas("captain",c => { c.build["ios-simulator"].ios.credentialsSource = "local"; },/simulator must inherit development/);
  rejectsEas("merchant",c => { c.build.base.pnpm = "1.0.0"; },/remote toolchain mismatch/);
});
test("malformed config is rejected with non-secret diagnostics",() => {
  const {manifest} = configFor("customer");
  assert.match(resolvedConfigIssues("customer",manifest,null).join(" "),/invalid resolved/);
  assert.match(easBuildIssues("customer",null).join(" "),/invalid EAS/);
  rejectsEas("merchant",c => { c.build.base = null; },/remote toolchain mismatch/);
  rejectsEas("customer",c => { c.build.development = null; },/unapproved development profile override/);
});
test("real installed Expo CLI resolves all three source configurations",() => {
  assert.equal(verifyResolvedConfigs(),3);
});
