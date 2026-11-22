import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = relative => readFileSync(new URL(relative, root), "utf8");

test("joining and setup share the canonical Identity Merchant gate, not an inert registration preview", () => {
  for (const route of ["src/features/onboarding/merchant-application.tsx",
    "src/features/onboarding/store-setup-screen.tsx"]) {
    const text = read(route);
    assert.match(text, /import MerchantIdentityGate from "\.\.\/access\/identity-gate";/);
    assert.match(text, /return <MerchantIdentityGate \/>;/);
    assert.doesNotMatch(text, /MerchantCapabilityScreen|registerMerchantStore\(|fetch\(/);
  }
  assert.match(read("app/apply.tsx"), /onboarding\/merchant-application/);
  assert.match(read("app/setup.tsx"), /onboarding\/store-setup-screen/);
});
test("joining only reveals Store admission after both Identity and DSH owner standing", () => {
  const gate = read("src/features/access/identity-gate.tsx");
  const workspace = read("src/features/navigation/merchant-workspace.tsx");
  assert.match(gate, /standing\s*\?/);
  assert.match(gate, /إنشاء حساب تاجر أو تسجيل الدخول/);
  assert.match(gate, /إذا كنت تاجرًا جديدًا يُضاف دور التاجر إلى حسابك نفسه/);
  assert.match(gate, /متاجرك أو خيار إنشاء متجر غير منشور/);
  assert.match(gate, /<MerchantWorkspace actorId=\{standing\.session\.actorId\}/);
  assert.match(workspace, /stores\.length === 0 \? <MerchantStoreRegistration actorId=\{actorId\}/);
  assert.match(workspace, /<MerchantStoreRegistration actorId=\{actorId\} onCreated=\{onRefresh\}/);
  assert.doesNotMatch(read("src/features/onboarding/merchant-application.tsx"), /storeRegistration:|role:\s*["']merchant/);
});