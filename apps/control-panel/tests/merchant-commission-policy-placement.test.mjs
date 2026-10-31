import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

const manifest = source("src/features/policies/policy-capabilities.ts");
const editors = source("src/features/policies/policy-editors.ts");
const policies = source("src/features/policies/policies-center-workspace.tsx");
const finance = source("src/features/finance/finance-center-workspace.tsx");
const route = source("app/api/finance/commercial-store-type-commission-defaults/route.ts");

test("merchant commission defaults have one owner-backed policy editor, never a second finance editor", () => {
  assert.match(manifest, /key: "store-type-commission-defaults"/);
  assert.match(manifest, /additionalPermission: "finance"/);
  assert.match(editors, /"store-type-commission-defaults": StoreTypeCommissionDefaultWorkspace/);
  assert.match(policies, /id:"commercial",label:"سياسات المتاجر"/);
  assert.match(finance, /<StoreCommercialAgreementWorkspace \/>/);
  assert.doesNotMatch(finance, /<StoreTypeCommissionDefaultWorkspace/);
});

test("the canonical finance reviewer links to the policy owner, while writes need both permissions", () => {
  assert.match(finance, /href="\/policies\?group=commercial&policy=store-type-commission-defaults&action=manage"/);
  assert.match(route, /identity\.permissions\.includes\("platform_policies"\)/);
  assert.match(route, /identity\.permissions\?\.includes\("finance"\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
});

test("policy reference values never become a Store agreement or Order price", () => {
  assert.match(manifest, /لا تُطبّق تلقائيًا/);
  assert.match(source("src/features/finance/store-type-commission-default-workspace.tsx"), /لا تغيّر الاتفاقيات النافذة أو الطلبات السابقة/);
});
