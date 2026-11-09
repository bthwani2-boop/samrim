import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePartnerAuthority, canonicalPartnerSurfacePath } from "./partner-authority.ts";

const store = (id, owned, permissions = [], relationModel = "BTHWANI_PARTNER") => ({ id, owned, permissions, relationModel });

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

test("an independent Store grants its own order surface, with no WLT wallet", () => {
  const independent = derivePartnerAuthority([store("independent", true, [], "INDEPENDENT_STORE")]);
  assert.equal(independent.canUse("products"), true);
  assert.equal(independent.canUse("store"), true);
  assert.equal(independent.canUse("employees"), true);
  assert.equal(independent.canUse("orders"), true);
  assert.equal(independent.canUse("wallet"), false);
  assert.equal(canonicalPartnerSurfacePath(independent), "/orders");

  const independentDelegate = derivePartnerAuthority([
    store("independent-grant", false, ["catalog", "orders", "finance_read", "promotions"], "INDEPENDENT_STORE"),
  ]);
  assert.equal(independentDelegate.canUse("products"), true);
  assert.equal(independentDelegate.canUse("orders"), true);
  assert.equal(independentDelegate.canUse("wallet"), false);
});

test("marketplace navigation authority cannot bleed into the independently selected Store", () => {
  const market = store("market", true, []);
  const independent = store("independent", true, [], "INDEPENDENT_STORE");

  // PartnerStoreScopeProvider supplies the selected Store only to this policy.
  const selectedMarket = derivePartnerAuthority([market]);
  const selectedIndependent = derivePartnerAuthority([independent]);
  assert.equal(selectedMarket.canUse("orders"), true);
  assert.equal(selectedMarket.canUse("wallet"), true);
  assert.equal(selectedIndependent.canUse("orders"), true);
  assert.equal(selectedIndependent.canUse("wallet"), false);

  const unknown = derivePartnerAuthority([{ ...store("unknown", true), relationModel: undefined }]);
  assert.equal(unknown.canUse("orders"), false);
  assert.equal(unknown.canUse("wallet"), false);
});


test("one canonical Orders surface serves marketplace and independent Stores without duplication", () => {
  const stores = [store("market", true), store("independent", true, [], "INDEPENDENT_STORE")];
  const authority = derivePartnerAuthority(stores);
  assert.equal(authority.surfaces.filter(surface => surface === "orders").length, 1);
  assert.equal(canonicalPartnerSurfacePath(authority), "/orders");
  const unauthorized = derivePartnerAuthority([store("independent", false, ["catalog"], "INDEPENDENT_STORE")]);
  assert.equal(unauthorized.canUse("orders"), false);
  assert.equal(unauthorized.canUse("wallet"), false);
});
