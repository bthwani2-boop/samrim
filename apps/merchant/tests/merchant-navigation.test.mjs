import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, '..');
const routes = ["app/apply.tsx","app/activate.tsx","app/setup.tsx","app/(app)/onboarding/index.tsx","app/(app)/orders/[id].tsx","app/(app)/products/[id].tsx","app/(app)/products/quick-prices.tsx","app/(app)/products/import.tsx","app/(app)/products/export.tsx","app/(app)/store/index.tsx","app/(app)/store/profile.tsx","app/(app)/store/availability.tsx","app/(app)/store/team.tsx","app/(app)/store/captains.tsx","app/(app)/store/agreements.tsx","app/(app)/store/public-link.tsx","app/(app)/promotions/index.tsx","app/(app)/activity.tsx","app/(app)/insights.tsx","app/(app)/employees.tsx","app/(app)/account.tsx","app/(app)/notifications.tsx"];

test("new merchant routes exist and refer to feature-owned presentation", () => {
  for (const route of routes) {
    assert.ok(existsSync(resolve(root, route)), route);
    assert.match(readFileSync(resolve(root, route), "utf8"), /export \{ default \} from/);
  }
});
test("private routes remain behind existing fail-closed Identity gate", () => {
  const layout = readFileSync(resolve(root, "app/(app)/_layout.tsx"), "utf8");
  assert.match(layout, /MerchantIdentityGate/);
  assert.doesNotMatch(layout, /<Slot|<Stack|<Tabs/);
  assert.equal(existsSync(resolve(root,"src/app")),false);
  assert.equal(existsSync(resolve(root,"app/(workspace)")),false);
});
