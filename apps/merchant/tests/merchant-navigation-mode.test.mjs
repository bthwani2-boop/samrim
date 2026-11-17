import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { merchantNavigationMode } from "../src/features/navigation/merchant-navigation-mode.ts";

test("Merchant navigation adapts without a second Web application", () => {
  assert.equal(merchantNavigationMode("web", 1024), "desktop");
  assert.equal(merchantNavigationMode("web", 1440), "desktop");
  assert.equal(merchantNavigationMode("web", 1023), "mobile");
  assert.equal(merchantNavigationMode("android", 1920), "mobile");
  assert.equal(merchantNavigationMode("ios", 1290), "mobile");
  assert.equal(merchantNavigationMode("web", Number.NaN), "mobile");
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
