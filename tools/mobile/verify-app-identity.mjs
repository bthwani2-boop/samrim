#!/usr/bin/env node
// Static registered identity and renderer boundary. The frozen pnpm graph,
// Expo's resolved config and native build checks own dependency compatibility.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = path => readFileSync(join(root, path), "utf8");
const json = path => JSON.parse(read(path));
const registered = {
  customer: ["customer", "com.bthwani.customer", "customer", "9b97c906-0dfc-4cf7-8d2b-079593523dc7"],
  merchant: ["merchant", "com.bthwani.merchant", "merchant", "c56092bf-d41b-4944-a28c-de227b3d8e8a"],
  captain: ["app-captain", "com.bthwani.captain", "captain", "7efa39e1-895f-44d7-a597-d613c79297b6"],
};
const names = Object.keys(registered);
const archiveExcludes = [
  "**/credentials.json", "**/google-services.json", "**/GoogleService-Info.plist",
  "**/*.jks", "**/*.keystore", "**/*.p12", "**/*.p8", "**/*.pem", "**/*.key",
  "**/.env", "**/.env.*", "**/mobile.env", "**/secrets.local.*", "**/*local*.secret.json",
];

export function assertRegisteredIdentity(name, manifest) {
  assert.ok(Object.hasOwn(registered, name), "Unknown mobile surface: " + name);
  const [slug, id, scheme, projectId] = registered[name];
  assert.deepEqual(
    [manifest.slug, manifest.androidPackage, manifest.iosBundleIdentifier, manifest.scheme, manifest.projectId, manifest.owner],
    [slug, id, id, scheme, projectId, "bthwani1"],
    name + " registered identity changed",
  );
}

function requirePng(path) {
  const png = readFileSync(join(root, path));
  assert.ok(png.length > 24, "Empty native PNG: " + path);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Invalid PNG: " + path);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR", "Missing PNG header: " + path);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.ok(width === height && width >= 512, "Native asset must be square and at least 512px: " + path);
}

function verifyMobile(name) {
  const base = "apps/" + name;
  const manifest = json(base + "/mobile.config.json");
  assertRegisteredIdentity(name, manifest);
  const pkg = json(base + "/package.json");
  assert.equal(pkg.name, "@bthwani/" + name);
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies["@bthwani/tamagui-config"], "workspace:*");
  assert.ok(pkg.dependencies.expo && pkg.dependencies["react-native"] && pkg.dependencies["expo-router"], name + " missing native renderer");
  const config = read(base + "/app.config.ts");
  assert.ok(config.includes(`defineBthwaniExpoApp("${manifest.slug}"`), name + " native config must use its registered owner");
  if (name !== "captain") {
    assert.notEqual(pkg.type, "module", name + " Expo SSR renderer requires CommonJS package semantics");
    assert.ok(config.includes('output: "server"'), name + " lost Expo Web SSR");
  }
  const ignored = new Set(read(base + "/.easignore").split(/\r?\n/).map(line => line.trim()));
  for (const pattern of archiveExcludes) assert.ok(ignored.has(pattern), name + " EAS archive must exclude " + pattern);
  assert.ok(read(base + "/metro.config.cjs").includes("getDefaultConfig(__dirname)"), name + " must use native Expo Metro defaults");
  assert.ok(read(base + "/index.js").includes("expo-router/entry"), name + " must use Expo Router");
  const layout = read(base + "/app/_layout.tsx");
  assert.ok(layout.includes('from "@bthwani/tamagui-config/appearance"') && layout.includes("createMobileAppearanceRoot("),
    name + " must use the shared appearance owner");
  // These already persisted external keys are a compatibility boundary, not
  // a Stage-4 implementation admission rule.
  assert.ok(layout.includes(`"bthwani.stage4.${name}.theme"`), name + " existing appearance preference key changed");
  const entry = name === "customer" ? "app/(tabs)/index.tsx" : "app/index.tsx";
  assert.ok(existsSync(join(root, base, entry)), "Missing app entry: " + name);
  if (name === "customer") {
    assert.ok(!existsSync(join(root, base, "app/index.tsx")), "Duplicated Customer / route");
    assert.ok(existsSync(join(root, base, "app/(tabs)/_layout.tsx")), "Customer Tabs missing");
    assert.ok(!existsSync(join(root, base, "app/foundation.tsx")), "Retired demo route must remain absent");
  }
  for (const asset of ["icon.png", "adaptive-icon.png", "splash-icon.png"]) requirePng(base + "/assets/" + asset);
}

function verifySharedOwners() {
  const design = json("packages/design-system/package.json");
  const renderer = json("packages/tamagui-config/package.json");
  assert.equal(design.exports["./theme"], "./src/semantics/themes.ts");
  assert.equal(design.exports["./web/css-projection"], "./src/web/css-projection.ts");
  assert.equal(renderer.exports["./appearance"], "./src/appearance.tsx");
  assert.ok(!Object.hasOwn(renderer.exports, "./preview"), "Retired presentation probe cannot be a package export");
  assert.equal(renderer.dependencies["@bthwani/design-system"], "workspace:*");
  for (const path of [
    "packages/design-system/src/tokens", "packages/design-system/src/theme", "packages/design-system/src/native",
    "packages/design-system/src/semantics/studio-palette.ts", "packages/tamagui-config/src/preview.tsx",
    "tools/mobile/create-bthwani-metro-config.cjs",
  ]) assert.ok(!existsSync(join(root, path)), "Retired presentation path: " + path);
}

export function verifyApplicationIdentities(selected = names) {
  assert.ok(selected.length > 0 && selected.every(name => names.includes(name)), "Unknown mobile surface");
  for (const name of selected) verifyMobile(name);
  verifySharedOwners();
  const operator = json("apps/control-panel/package.json");
  assert.equal(operator.name, "@bthwani/control-panel");
  assert.equal(operator.private, true);
  assert.ok(operator.dependencies.antd && operator.dependencies.next, "Operator renderer dependencies missing");
  return selected.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--app" && names.includes(args[1])),
    "Usage: node tools/mobile/verify-app-identity.mjs [--app customer|merchant|captain]");
  const count = verifyApplicationIdentities(args.length ? [args[1]] : names);
  console.log(`APPLICATION_IDENTITY_PASS apps=${count} native_build=NOT_RUN`);
}
