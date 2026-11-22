import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { alignCheckoutFunding } from "./checkout-funding-state.ts";

const evidence = {
  kind: "ready",
  balance: { actorId: "customer-a", currency: "YER", balanceYer: "9007199254740993" },
  expiresAt: 20000,
};

test("checkout WLT evidence stays read-only and belongs to the current DSH cart actor", () => {
  assert.deepEqual(alignCheckoutFunding("customer-a", evidence, 10000), evidence);
  assert.deepEqual(alignCheckoutFunding("customer-b", evidence, 10000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("", evidence, 10000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", evidence, 20000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", { ...evidence, expiresAt: Number.NaN }, 10000),
    { kind: "signed-out" });
});

test("checkout funding rejects unavailable or revoked WLT read without fallback", () => {
  assert.deepEqual(alignCheckoutFunding("customer-a", { kind: "signed-out" }), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", { kind: "unavailable" }), { kind: "unavailable" });
});

test("checkout web and native adapters reuse existing verified WLT reader, not a financial writer", () => {
  for (const name of ["checkout-funding.web.ts", "checkout-funding.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.match(source, /alignCheckoutFunding\(cartActorId, result\)/);
    assert.match(source, /signal\.throwIfAborted\(\)/);
    assert.doesNotMatch(source, /fetch\(|writeWallet|charge\(|createOrder\(/);
  }
  assert.match(readFileSync(new URL("./checkout-funding.web.ts", import.meta.url), "utf8"),
    /readVerifiedWallet\(readCustomerAdmission, signal\)/);
  assert.match(readFileSync(new URL("./checkout-funding.ts", import.meta.url), "utf8"),
    /readNativeWallet\(signal\)/);
});
