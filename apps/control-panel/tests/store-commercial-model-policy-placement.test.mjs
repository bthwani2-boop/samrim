import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const manifest = read("src/features/policies/policy-capabilities.ts");
const editors = read("src/features/policies/policy-editors.ts");
const center = read("src/features/policies/policies-center-workspace.tsx");
const proposal = read("src/features/partner-onboarding/store-commercial-agreement-proposal.tsx");
const store = read("src/features/stores/store-profile-tabs.tsx");
const joining = read("src/features/partner-onboarding/joining-case-detail.tsx");
const route = read("app/api/partners/stores/[storeId]/commercial-agreements/route.ts");

test("a single store-model chooser belongs to the policies section, not another financial writer", () => {
  assert.match(manifest, /key: "store-commercial-model"/);
  assert.match(editors, /"store-commercial-model": StoreCommercialModelPolicyWorkspace/);
  assert.match(center, /"store-commercial-model"/);
  const editor = read("src/features/policies/store-commercial-model-policy-workspace.tsx");
  assert.match(editor, /storeId/);
  assert.match(editor, /\/api\/stores\/\$\{encodeURIComponent\(storeId\)\}\/publication/);
  assert.match(editor, /result\.store\?\.id !== storeId/);
  assert.match(editor, /<StoreCommercialAgreementProposal/);
  assert.match(editor, /readOnly=\{false\}/);
});

test("existing partner/store surfaces read commercial agreements, but model edits open policies", () => {
  assert.match(proposal, /readOnly = true/);
  assert.match(proposal, /if \(readOnly \|\| busy/);
  assert.match(proposal, /!readOnly \? <>/);
  assert.match(store, /policy=store-commercial-model/);
  assert.match(joining, /policy=store-commercial-model/);
});

test("contract proposal mutation requires operator partners and platform policy authority", () => {
  const postStart = route.indexOf("export async function POST(");
  assert.ok(postStart > 0);
  assert.match(route.slice(postStart), /platform_policies/);
  assert.match(route, /permissions\?\.includes\("partners"\)/);
  assert.match(manifest, /permissions\.includes\("partners"\)/);
});

test("WLT relation defaults are owner-backed for both Merchant relations and remain prospective", () => {
  const policy = read("src/features/policies/store-relation-commercial-model-defaults.tsx");
  const view = read("src/features/policies/store-commercial-model-policy-workspace.tsx");
  const route = read("app/api/policies/store-commercial-model-defaults/route.ts");
  const server = read("src/server/dsh/store-relation-commercial-model.ts");
  const contract = read("../../services/dsh/contracts/openapi/paths/commerce.yaml");
  const wlt = read("../../services/wlt/backend/internal/storage/postgres/store_relation_commercial_model_default.go");
  assert.match(policy, /"INDEPENDENT_STORE"/);
  assert.match(policy, /"BTHWANI_PARTNER"/);
  assert.match(policy, /"COMMISSION"/);
  assert.match(policy, /"SUBSCRIPTION"/);
  assert.match(policy, /stablePartnerMutationHeaders/);
  assert.match(policy, /expectedVersion/);
  assert.match(policy, /await read\(\)/);
  assert.match(view, /StoreRelationCommercialModelDefaults/);
  assert.match(view, /suggestedModel/);
  // A prospective default service rollout must never disable the existing Store agreement writer.
  assert.match(view, /\{selected \? <>/);
  assert.doesNotMatch(view, /selected && defaults !== null \? <>/);
  assert.match(route, /verifySameOrigin/);
  for (const permission of ["platform_policies", "partners", "finance"]) {
    assert.ok(route.includes(`includes("${permission}")`), "missing route permission " + permission);
  }
  assert.match(server, /requestDshJson/);
  assert.match(server, /dshOperationPaths/);
  assert.match(contract, /readOperatorStoreRelationCommercialModelDefaults/);
  assert.match(contract, /updateOperatorStoreRelationCommercialModelDefault/);
  assert.match(wlt, /wlt\.store_relation_commercial_model_defaults/);
  assert.match(wlt, /wlt\.store_relation_commercial_model_default_events/);
  assert.doesNotMatch(wlt, /UPDATE wlt\.store_commercial_agreements/);
});
