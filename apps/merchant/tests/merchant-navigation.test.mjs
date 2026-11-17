import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, '..');
const routes = ["app/apply.tsx","app/activate.tsx","app/setup.tsx","app/onboarding/index.tsx","app/orders/[id].tsx","app/products/[id].tsx","app/products/quick-prices.tsx","app/products/import.tsx","app/products/export.tsx","app/store/index.tsx","app/store/profile.tsx","app/store/availability.tsx","app/store/team.tsx","app/store/captains.tsx","app/store/agreements.tsx","app/store/public-link.tsx","app/promotions/index.tsx","app/activity.tsx","app/insights.tsx","app/employees.tsx","app/account.tsx","app/notifications.tsx"];

test("new merchant routes exist and refer to feature-owned presentation", () => {
  for (const route of routes) {
    assert.ok(existsSync(resolve(root, route)), route);
    assert.match(readFileSync(resolve(root, route), "utf8"), /export \{ default \} from/);
  }
});
test("private routes remain behind existing fail-closed Identity gate", () => {
  const layout = readFileSync(resolve(root, "app/_layout.tsx"), "utf8");
  assert.match(layout, /<Stack\.Protected guard=\{false\} redirectTo="\/">/);
  assert.match(readFileSync(resolve(root, "app/index.tsx"), "utf8"), /MerchantIdentityGate/);
  assert.equal(existsSync(resolve(root,"src/app")),false);
  assert.equal(existsSync(resolve(root,"app/(app)")),false);
  assert.equal(existsSync(resolve(root,"app/(workspace)")),false);
});
