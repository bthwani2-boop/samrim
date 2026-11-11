import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

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

test("independent Store owner can read and reach the same WLT agreement while delegates remain barred", () => {
  const source = ts.createSourceFile("partner-store.tsx", store, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "eligibleForSection");
  assert.ok(declaration, "Reuse the production Partner Store eligibility owner");
  const code = ts.transpileModule(declaration.getText(source) + "\neligibleForSection;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const eligible = vm.runInNewContext(code, { mayPrepareIndependentStoreBanners: () => false });
  const independent = { relationModel: "INDEPENDENT_STORE", owned: true, permissions: [] };
  const marketplace = { relationModel: "BTHWANI_PARTNER", owned: true, permissions: [] };
  assert.equal(eligible(independent, "commercial"), true);
  assert.equal(eligible(marketplace, "commercial"), true);
  assert.equal(eligible({ ...independent, owned: false }, "commercial"), false);
  assert.equal(eligible({ ...marketplace, owned: false, permissions: ["finance_read"] }, "commercial"), false);
  assert.equal(eligible({ relationModel: "UNKNOWN", owned: true, permissions: [] }, "commercial"), false);
  assert.equal(eligible(independent, "team"), false, "Direct Store must not inherit marketplace Captain controls");
  assert.match(shell, /if \(isOwner\) management\.push\(\{ label: "الاتفاقية التجارية"/);
  assert.match(mobile, /const canReviewAgreement=Boolean\(selectedStore\?\.owned && \(marketplace\|\|independent\)\)/);
  assert.match(home, /\{\(marketplace \|\| independent\) && store\.owned \? action\("الاتفاقية التجارية"/);
});
