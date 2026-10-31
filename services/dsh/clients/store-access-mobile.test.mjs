import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStoreAccessInvitationInput, validStoreAccessPermissionSet } from "./store-access-request.ts";

const permissions = ["orders", "catalog", "store_operations", "promotions", "finance_read", "payout_request", "fulfillment"];

test("Store delegation payload preserves employee identity and all seven supported scopes", () => {
  const input = { delegatePhoneE164: " +967771234567 ", displayNameAr: "  موظف الاختبار  ", permissions };
  const output = normalizeStoreAccessInvitationInput(input);
  assert.deepEqual(output, { delegatePhoneE164: "+967771234567", displayNameAr: "موظف الاختبار", permissions });
  assert.notStrictEqual(output.permissions, input.permissions);
  assert.equal(input.displayNameAr, "  موظف الاختبار  ");
  assert.deepEqual(normalizeStoreAccessInvitationInput({ delegatePhoneE164: "+967771234567", permissions: ["orders"] }),
    { delegatePhoneE164: "+967771234567", permissions: ["orders"] });
});

test("Store delegation rejects noncanonical permission combinations before HTTP request", () => {
  assert.equal(validStoreAccessPermissionSet(permissions), true);
  assert.equal(validStoreAccessPermissionSet(["finance_read"]), true);
  assert.equal(validStoreAccessPermissionSet(["orders", "fulfillment"]), true);
  for (const list of [[], ["fulfillment"], ["orders", "orders"], ["not-admitted"], [...permissions, "not-admitted"]]) {
    assert.equal(validStoreAccessPermissionSet(list), false, "invalid: " + String(list));
    assert.throws(() => normalizeStoreAccessInvitationInput({ delegatePhoneE164: "+967771234567", permissions: list }));
  }
  assert.throws(() => normalizeStoreAccessInvitationInput({ delegatePhoneE164: "+967771234567", displayNameAr: "م".repeat(81), permissions: ["orders"] }));
  assert.throws(() => normalizeStoreAccessInvitationInput({ delegatePhoneE164: "77", permissions: ["orders"] }));
});
