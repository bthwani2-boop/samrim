import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../src");
const read = name => readFileSync(path.join(root, name), "utf8");
const store = read("features/partner-onboarding/partner-store.tsx");
const shell = read("shell/partner-desktop-workspace.tsx");
const mobile = read("features/partner-onboarding/partner-more.tsx");
const home = read("features/partner-onboarding/partner-desktop-home.tsx");
const setup = read("features/partner-onboarding/partner-onboarding-next-step.ts");
const settings = read("features/partner-onboarding/partner-store-settings-overview.tsx");

test("commercial agreement has its own owner-only store surface with canonical component", () => {
  assert.match(store, /type StoreSection = [^;]*"commercial"/);
  assert.match(store, /section === "commercial"\s*\?\s*<StoreCommercialAgreements/);
  assert.doesNotMatch(store, /section === "settings"[\s\S]*?<StoreCommercialAgreements/);
  assert.match(store, /if \(store\.owned\) return true/);
  assert.match(store, /: false;/);
});

test("partner mobile, desktop, and home open commercial terms directly, never activate plans", () => {
  assert.match(shell, /label: "الاتفاقية التجارية", href: "\/store\?section=commercial"/);
  assert.match(mobile, /pathname:"\/store",params:\{section:"commercial",returnTo:"more"\}/);
  assert.match(home, /action\("الاتفاقية التجارية"[^\n]*"\/store\?section=commercial"/);
  assert.match(setup, /href: "\/store\?section=commercial"/);
  assert.doesNotMatch(shell + mobile + home, /enableSubscription|activateSubscription|payForFeatures/);
});

test("store settings offers explicit path to canonical agreement without duplicating it", () => {
  assert.match(settings, /label="الاتفاقية التجارية"/);
  assert.match(settings, /section: "commercial"/);
});
