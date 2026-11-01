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
  assert.match(finance, /<StoreTypeCommissionDefaultWorkspace readOnly \/>/);
  const viewer = source("src/features/finance/store-type-commission-default-workspace.tsx");
  assert.match(viewer, /if \(readOnly\) return;/);
  assert.match(viewer, /!readOnly \? <div className="action-row"/);
  assert.match(viewer, /!readOnly \? <label className="field-label" htmlFor="store-type-commission-default-reason"/);
});

test("the canonical finance reviewer links to the policy owner, while writes need both permissions", () => {
  assert.match(finance, /href="\/policies\?group=commercial&policy=store-type-commission-defaults&action=manage"/);
  assert.match(finance, /canEditStoreTypePolicies=\{state\.identity\.permissions\?\.includes\("platform_policies"\) === true\}/);
  assert.match(finance, /استعراض نسب المتاجر المقترحة \(قراءة فقط\)/);
  assert.match(route, /identity\.permissions\.includes\("platform_policies"\)/);
  assert.match(route, /identity\.permissions\?\.includes\("finance"\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
});

test("policy reference values never become a Store agreement or Order price", () => {
  assert.match(manifest, /لا تُطبّق تلقائيًا/);
  assert.match(source("src/features/finance/store-type-commission-default-workspace.tsx"), /لا تغيّر الاتفاقيات النافذة أو الطلبات السابقة/);
});


test("commission suggestion preview does not wait for a nonexistent aggregate", () => {
  const peek = source("src/features/policies/policy-quick-peek.tsx");
  assert.match(peek, /policy\.key !== "store-type-commission-defaults"/);
  assert.match(peek, /\{hasHistory \? <details className="policy-quick-peek-history">/);
  assert.match(peek, /لا تتوفر قراءة مجمعة موثوقة لهذا النوع/);
});

test("governed agreement versions explicitly identify their commercial model", () => {
  const contract = readFileSync(new URL("../../docs/governance/product/capabilities/finance/store-commercial-agreement.md", root), "utf8");
  assert.match(contract, /each version explicitly identifies Store, the selected commercial model/);
  assert.match(contract, /zero product commission never implies subscription/);
});
