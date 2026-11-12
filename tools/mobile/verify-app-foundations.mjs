#!/usr/bin/env node
// Source-version preservation guard for Stage 4. This is static contract
// verification, not Expo bundling, native development-build or device proof.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const donor = json("docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json");
const expectedIds = {
  customer: ["app-client", "com.bthwani.client", "client", "4adf3184-fc07-4186-b49e-0dc821a5ab73"],
  merchant: ["app-partner", "com.bthwani.partner", "partner", "bcd22a76-d4b2-4de0-93b3-f6d13074a802"],
  captain: ["app-captain", "com.bthwani.captain", "captain", "7efa39e1-895f-44d7-a597-d613c79297b6"],
};
let external = 0;
for (const [name, [slug, packageId, scheme, projectId]] of Object.entries(expectedIds)) {
  const rel = `apps/${name}`;
  const source = donor.apps[name]?.manifest;
  assert.ok(source, "Missing original manifest " + name);
  const current = json(`${rel}/package.json`);
  assert.equal(current.private, true);
  assert.equal(current.dependencies["@bthwani/design-system"], "workspace:*");
  assert.equal(current.dependencies["@bthwani/tamagui-config"], "workspace:*");
  for (const [kind, original] of Object.entries({dependencies: source.dependencies, devDependencies: source.devDependencies})) {
    for (const [dependency, version] of Object.entries(original ?? {})) {
      if (dependency.startsWith("@bthwani/")) continue; // Deferred owner clients, not false mocks.
      assert.equal(current[kind][dependency], version, `${name} drift in ${kind} ${dependency}`);
      external++;
    }
  }
  const manifest = json(`${rel}/mobile.config.json`);
  assert.deepEqual([manifest.slug,manifest.androidPackage,manifest.scheme,manifest.projectId],
    [slug,packageId,scheme,projectId], name + " app identity changed");
  assert.equal(manifest.iosBundleIdentifier,packageId);
  assert.equal(manifest.owner,"bthwani1");
  const cfg = read(`${rel}/app.config.ts`);
  assert.ok(cfg.includes(`defineBthwaniExpoApp("${slug}"`), name + " original native config lost");
  if (name === "customer" || name === "merchant") {
    // SDK 58 currently exports a CommonJS SSR renderer. In a type:module
    // package, `expo serve` returns HTTP 500: module is not defined.
    assert.notEqual(current.type, "module", name + " Expo SSR renderer cannot run as ESM");
    assert.ok(cfg.includes('output: "server"'), name + " lost actual Expo Web SSR");
  }
  assert.ok(read(`${rel}/metro.config.cjs`).includes("getDefaultConfig(__dirname)"));
  assert.ok(read(`${rel}/index.js`).includes("expo-router/entry"));
  for (const path of ["app/_layout.tsx","app/index.tsx","app/health.tsx","assets/icon.png",
    "assets/adaptive-icon.png","assets/splash-icon.png","eas.json"]) {
    assert.ok(existsSync(join(root,rel,path)), `Missing ${rel}/${path}`);
  }
  assert.ok(!existsSync(join(root,rel,"src/features")), name + " old business features should not migrate");
  const home=read(`${rel}/app/index.tsx`);
  assert.ok(home.includes('from "tamagui"'), name + " not rendering Tamagui");
}
const oldPanel=donor.apps["control-panel"]?.manifest;
const newPanel=json("apps/control-panel/package.json");
for(const kind of ["dependencies","devDependencies"]) {
  for(const [dep,version] of Object.entries(oldPanel?.[kind] ?? {})) {
    if(dep.startsWith("@bthwani/")||dep==="xlsx")continue; // features deferred
    assert.equal(newPanel[kind][dep],version,"Operator dependency drift "+dep);
    external++;
  }
}
assert.equal(newPanel.dependencies.antd,"6.6.7");
assert.equal(newPanel.dependencies.next,"16.4.3");
assert.equal(json("packages/tamagui-config/package.json").dependencies.tamagui,"3.3.1");
assert.equal(json("packages/tamagui-config/package.json").dependencies["@tamagui/config"],"3.3.1");
const ap=read("packages/design-system/src/native/appearance.tsx");
assert.ok(!ap.includes('from "@expo/ui"'),"Old native Expo UI appearance picker is not canonical");
assert.ok(!existsSync(join(root,"packages/design-system/src/theme/studio-palette.ts")),
  "Unimplemented Studio engine must not be imported from donor");
assert.ok(!existsSync(join(root,"tools/mobile/create-bthwani-metro-config.cjs")),
  "Legacy Metro watcher/cache implementation must not be copied");
const native=read("tools/mobile/define-bthwani-expo-app.cjs");
assert.ok(!native.includes('"C:\\\\BTHWANI-Secrets\\\\samrim"'),"Native config depends on donor secret path");
for(const app of ["customer","merchant","captain"]) {
  const cfg=read(`apps/${app}/eas.json`);
  assert.ok(cfg.includes('"version": "24.7.0"'),"Original EAS CLI pin changed");
}
console.log(`STAGE4_SOURCE_VERSIONS_AND_IDENTITIES_PASS apps=3 operator=1 dependency_assertions=${external} native_build=NOT_RUN`);
