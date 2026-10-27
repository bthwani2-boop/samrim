import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const root = process.cwd();
const common = {
  "@tanstack/react-query": "5.104.5",
  "react-hook-form": "7.91.0",
  "zod": "4.6.7",
  "@hookform/resolvers": "6.0.0",
  "date-fns": "4.4.0",
  "@date-fns/tz": "1.5.0",
};
const catalogYaml = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
const catalogSection = catalogYaml.match(/^catalog:\r?\n([\s\S]*?)(?=^overrides:)/m)?.[1];
assert.ok(catalogSection, "shared pnpm catalog must be present");
const sharedCatalog = new Map(
  Array.from(catalogSection.matchAll(/^  "([^"]+)": "([^"]+)"$/gm), ([, name, version]) => [name, version]),
);
const mobile = {
  "@shopify/flash-list": "2.3.2",
  "zustand": "5.0.16",
  "xstate": "5.33.3",
};
const extras = {
  "app-client": { "react-native-reanimated-carousel": "5.2.0" },
  "app-partner": {},
  "app-captain": {},
  "app-field": {},
  "control-panel": {
    "recharts": "3.10.1",
    "@radix-ui/react-dialog": "1.3.1",
    "@radix-ui/react-alert-dialog": "1.2.1",
    "@radix-ui/react-select": "2.4.1",
    "@radix-ui/react-dropdown-menu": "2.2.1",
    "@radix-ui/react-popover": "1.3.1",
  },
};
for (const [app, other] of Object.entries(extras)) {
  test(app + " engine packages are pinned and independently resolvable", () => {
    const filename = path.join(root, "apps", app, "package.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    const localRequire = createRequire(filename);
    const dependencies = { ...common, ...(app === "control-panel" ? {} : mobile), ...other };
    for (const [name, pinnedVersion] of Object.entries(dependencies)) {
      if (Object.hasOwn(common, name)) {
        assert.equal(manifest.dependencies[name], "catalog:", app + " " + name);
        assert.equal(sharedCatalog.get(name), pinnedVersion, "shared catalog " + name);
      } else {
        assert.equal(manifest.dependencies[name], pinnedVersion, app + " " + name);
      }
      assert.ok(localRequire.resolve(name), "unable to resolve " + name);
    }
    // Shared platform versions cannot drift as a side effect of a package-adoption roll-out.
    assert.equal(manifest.dependencies.react, "19.3.0");
    if (app === "control-panel") {
      assert.equal(manifest.dependencies["@tanstack/react-table"], undefined, "AntD Table owns generic CP tables");
      assert.equal(manifest.dependencies["@tanstack/react-virtual"], undefined, "AntD virtual replaces the legacy CP virtualizer");
    } else {
      assert.equal(manifest.dependencies.expo, "58.0.19");
      assert.equal(manifest.dependencies["react-native"], "0.88.0");
      assert.equal(manifest.dependencies["@expo/ui"], "58.0.23");
    }
  });
}
test("Reanimated Carousel is isolated to the client and remains an unactivated pilot", () => {
  const carouselPath = path.join(root, "apps/app-client/package.json");
  const manifest = JSON.parse(fs.readFileSync(carouselPath, "utf8"));
  assert.equal(manifest.dependencies["react-native-reanimated-carousel"], "5.2.0");
  for (const app of ["app-partner","app-captain","app-field"]) {
    const other = JSON.parse(fs.readFileSync(path.join(root, "apps", app, "package.json"), "utf8"));
    assert.equal(other.dependencies["react-native-reanimated-carousel"], undefined);
  }
  const banner = fs.readFileSync(path.join(root,"apps/app-client/src/features/store-discovery/looping-hero-banner.tsx"),"utf8");
  assert.match(banner, /export function LoopingHeroBanner/);
  assert.doesNotMatch(banner, /react-native-reanimated-carousel/);
});
