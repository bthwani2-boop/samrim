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

test("Merchant mobile display name does not change the installed app identity", () => {
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../mobile.config.json"), "utf8"));
  assert.equal(manifest.name, "بثواني التاجر");
  assert.equal(manifest.slug, "app-partner");
  assert.equal(manifest.scheme, "partner");
  assert.equal(manifest.androidPackage, "com.bthwani.partner");
  assert.equal(manifest.iosBundleIdentifier, "com.bthwani.partner");
  assert.equal(manifest.projectId, "bcd22a76-d4b2-4de0-93b3-f6d13074a802");
});
