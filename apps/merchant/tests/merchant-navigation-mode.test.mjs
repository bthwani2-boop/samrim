import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { usesDesktopNavigation } from "../../../packages/tamagui-config/src/navigation-mode.ts";

test("Expo navigation uses a desktop sidebar only on wide web", () => {
  assert.equal(usesDesktopNavigation("web", 1024), true);
  assert.equal(usesDesktopNavigation("web", 1440), true);
  assert.equal(usesDesktopNavigation("web", 1023), false);
  assert.equal(usesDesktopNavigation("android", 1920), false);
  assert.equal(usesDesktopNavigation("ios", 1290), false);
  assert.equal(usesDesktopNavigation("web", Number.NaN), false);
});

test("Merchant uses the separately registered native application identity", () => {
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../mobile.config.json"), "utf8"));
  assert.equal(manifest.name, "بثواني التاجر");
  assert.equal(manifest.slug, "merchant");
  assert.equal(manifest.scheme, "merchant");
  assert.equal(manifest.androidPackage, "com.bthwani.merchant");
  assert.equal(manifest.iosBundleIdentifier, "com.bthwani.merchant");
  assert.equal(manifest.projectId, "c56092bf-d41b-4944-a28c-de227b3d8e8a");
});
