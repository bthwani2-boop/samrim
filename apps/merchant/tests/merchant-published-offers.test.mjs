import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const workspace = readFileSync(resolve(root, "src/features/navigation/merchant-workspace.tsx"), "utf8");
const component = resolve(root, "src/features/catalog/merchant-published-offers.tsx");

test("verified Merchant products section renders real DSH published offers, not a placeholder", () => {
  assert.ok(existsSync(component), "the published Store Offer reader must be implemented");
  assert.match(workspace, /section === "products"\s*\?\s*\(?.*MerchantPublishedOffers/s);
  assert.match(workspace, /<MerchantPublishedOffers\s+actorId=\{actorId\}\s+stores=\{stores\}/);
  const code = readFileSync(component, "utf8");
  assert.match(code, /listPublicOffers\(/, "owner-backed public catalogue reader is required");
  assert.match(code, /store\.published/, "draft Stores must not use public discovery as if published");
  assert.match(code, /actorId/, "visible read must be scoped to the current verified actor");
  assert.match(code, /AbortController/, "switching Stores or account must cancel pending read");
  assert.match(code, /page\.revision/, "pagination must keep the same owner revision");
  assert.doesNotMatch(code, /localStorage|AsyncStorage|SecureStore/, "no duplicate local catalogue");
});
