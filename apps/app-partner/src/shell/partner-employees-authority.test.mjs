import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePartnerAuthority, canonicalPartnerSurfacePath } from "./partner-authority.ts";

const store = (id, owned, permissions = []) => ({ id, owned, permissions });

test("only the Store owner sees the main Employees surface", () => {
  const owner = derivePartnerAuthority([store("store-owned", true)]);
  assert.equal(owner.canUse("employees"), true);
  assert.equal(owner.surfaces.includes("employees"), true);
  assert.equal(owner.canUse("orders"), true);
  const delegate = derivePartnerAuthority([store("store-granted", false, ["orders", "catalog", "finance_read", "store_operations"])]);
  assert.equal(delegate.canUse("employees"), false);
  assert.equal(delegate.canUse("orders"), true);
  assert.equal(delegate.canUse("wallet"), true);
  assert.equal(delegate.canUse("store"), true);
  const empty = derivePartnerAuthority([]);
  assert.equal(empty.canUse("employees"), false);
  assert.equal(canonicalPartnerSurfacePath(empty), "/more");
});

test("an owner of one Store may manage staff while operating a separate granted Store", () => {
  const mixed = derivePartnerAuthority([
    store("shared-store", false, ["orders"]),
    store("owned-store", true),
  ]);
  assert.equal(mixed.canUse("employees"), true);
  assert.equal(mixed.owner, true);
});
