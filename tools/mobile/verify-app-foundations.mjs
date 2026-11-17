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
// Donor pins apply to unrelated libraries; Expo CLI now owns SDK 58 dependency compatibility.
const sdkManaged = (name) => name === "expo" || name.startsWith("expo-") ||
  name.startsWith("@expo/") || name === "react-native" ||
  name === "react-native-safe-area-context" || name === "react-native-screens" ||
  name === "@react-native/metro-config";
const expectedIds = {
  customer: ["customer", "com.bthwani.customer", "customer", "9b97c906-0dfc-4cf7-8d2b-079593523dc7"],
  merchant: ["merchant", "com.bthwani.merchant", "merchant", "c56092bf-d41b-4944-a28c-de227b3d8e8a"],
  captain: ["app-captain", "com.bthwani.captain", "captain", "7efa39e1-895f-44d7-a597-d613c79297b6"],
};
let external = 0;
for (const [name, [slug, packageId, scheme, projectId]] of Object.entries(expectedIds)) {
  const rel = `apps/${name}`;
  const source = donor.apps[name]?.manifest;
  assert.ok(source, "Missing original manifest " + name);
  const current = json(`${rel}/package.json`);
  assert.equal(current.private, true);
  assert.equal(current.dependencies["@bthwani/tamagui-config"], "workspace:*");
  for (const [kind, original] of Object.entries({dependencies: source.dependencies, devDependencies: source.devDependencies})) {
    for (const [dependency, version] of Object.entries(original ?? {})) {
      if (dependency.startsWith("@bthwani/")) continue; // Deferred owner clients, not false mocks.
      if (sdkManaged(dependency)) continue; // Expo SDK validation replaces donor pin check.
      assert.equal(current[kind][dependency], version, `${name} drift in ${kind} ${dependency}`);
      external++;
    }
  }
  assert.equal(current.dependencies["react-native"], "0.88.1", name + " React Native target drift");
  assert.equal(current.dependencies.expo.replace(/^~/, ""), "58.0.25", name + " Expo patch target drift");
  assert.equal(current.devDependencies["@react-native/metro-config"], "0.88.1", name + " Metro target drift");
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
    const easIgnored = new Set(read(`${rel}/.easignore`).split(/\r?\n/).map(line => line.trim()));
    for (const protectedPath of [
      "**/credentials.json", "**/google-services.json", "**/GoogleService-Info.plist",
      "**/*.jks", "**/*.keystore", "**/*.p12", "**/*.p8", "**/*.pem", "**/*.key",
      "**/.env", "**/.env.*", "**/mobile.env", "**/secrets.local.*",
      "**/*local*.secret.json"
    ]) {
      assert.ok(easIgnored.has(protectedPath),
        name + " EAS archive could expose a local secret or signing file: " + protectedPath);
    }
  }
  assert.ok(read(`${rel}/metro.config.cjs`).includes("getDefaultConfig(__dirname)"));
  assert.ok(read(`${rel}/index.js`).includes("expo-router/entry"));
  // Customer / lives under URL-invisible Tabs; Merchant/Captain keep public entry gates.
  const routeEntry = name === "customer" ? "app/(tabs)/index.tsx" : "app/index.tsx";
  for (const path of ["app/_layout.tsx",routeEntry,"assets/icon.png",
    "assets/adaptive-icon.png","assets/splash-icon.png","eas.json"]) {
    assert.ok(existsSync(join(root,rel,path)), "Missing " + rel + "/" + path);
  }
  if (name === "customer") {
    assert.ok(!existsSync(join(root,rel,"app/index.tsx")), "Duplicated Customer / route");
    assert.ok(existsSync(join(root,rel,"app/(tabs)/_layout.tsx")), "Customer Tabs missing");
  }
  // Native Expo store assets must remain valid, large, square PNG files.
  // Existence alone does not prove a usable CNG icon or splash asset.
  for (const asset of ["icon.png", "adaptive-icon.png", "splash-icon.png"]) {
    const png = readFileSync(join(root, rel, "assets", asset));
    assert.ok(png.length > 24, name + " empty native PNG: " + asset);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a",
      name + " invalid PNG signature: " + asset);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR",
      name + " missing PNG header: " + asset);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.ok(width === height && width >= 512,
      name + " native PNG must be square and at least 512 px: " + asset);
  }
  // Progressive feature modules are allowed under src/features. Cross-owner imports,
  // private package internals and duplicate route roots remain checked by
  // verify-application-boundaries.mjs; a folder name is not an admission gate.
  // Real progressive Home screens may replace the Stage-4 preview. The shared
  // theme/runtime boundary remains enforced by the app layout and import scanner.
  const layout = read(`${rel}/app/_layout.tsx`);
  assert.ok(layout.includes('from "@bthwani/tamagui-config/preview"'), name + " must use the shared Stage-4 appearance host");
  assert.ok(layout.includes(`"bthwani.stage4.${name}.theme"`), name + " appearance persistence must remain app-scoped");
}
const oldPanel=donor.apps["control-panel"]?.manifest;
const newPanel=json("apps/control-panel/package.json");
for(const kind of ["dependencies","devDependencies"]) {
  for(const [dep,version] of Object.entries(oldPanel?.[kind] ?? {})) {
    if(dep.startsWith("@bthwani/")||dep==="xlsx"||dep==="next")continue; // features deferred; Next security upgrade is pinned and asserted below
    assert.equal(newPanel[kind][dep],version,"Operator dependency drift "+dep);
    external++;
  }
}
assert.equal(newPanel.dependencies.antd,"6.6.7");
assert.equal(newPanel.dependencies.next,"16.4.5");
assert.equal(json("packages/tamagui-config/package.json").dependencies.tamagui,"3.3.1");
assert.equal(json("packages/tamagui-config/package.json").dependencies["@tamagui/config"],"3.3.1");
// Stage-4 renderer-boundary evidence: no second numeric token authority.
const designPackage = json("packages/design-system/package.json");
const rendererPackage = json("packages/tamagui-config/package.json");
assert.equal(designPackage.exports["./theme"], "./src/semantics/themes.ts");
assert.equal(designPackage.exports["./web/css-projection"], "./src/web/css-projection.ts");
assert.equal(rendererPackage.exports["./appearance"], "./src/appearance.tsx");
for (const path of ["packages/design-system/src/tokens", "packages/design-system/src/theme",
  "packages/design-system/src/native"]) {
  assert.ok(!existsSync(join(root, path)), "Retired design owner must stay absent: " + path);
}
const ap=read("packages/tamagui-config/src/appearance.tsx");
assert.ok(!ap.includes('from "@expo/ui"'),"Old native Expo UI appearance picker is not canonical");
assert.ok(!existsSync(join(root,"packages/design-system/src/semantics/studio-palette.ts")),
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
