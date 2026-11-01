import assert from "node:assert/strict";
import { test } from "node:test";
import { customerPageCounts, customerStateLabel } from "../src/features/customers/customer-directory-page-counts.ts";

test("customer status counts are mutually exclusive for the visible Identity page", () => {
  const page = [
    { enabled: true, securityEnabled: true },
    { enabled: false, securityEnabled: true },
    { enabled: true, securityEnabled: false },
    { enabled: false, securityEnabled: false },
  ];
  assert.deepEqual(customerPageCounts(page), { total: 4, active: 1, suspended: 1, blocked: 2 });
  assert.deepEqual(page.map(customerStateLabel), ["نشط", "موقوف", "محظور أمنيًا", "محظور أمنيًا"]);
});

test("no page rows means zero counts, not a platform total", () => {
  assert.deepEqual(customerPageCounts([]), { total: 0, active: 0, suspended: 0, blocked: 0 });
});
