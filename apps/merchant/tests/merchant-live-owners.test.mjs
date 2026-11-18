import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/admission+api.ts";

const enabled = process.env.BTHWANI_MERCHANT_JOINED_E2E === "true";
const identity = "http://127.0.0.1:33221";
const dsh = "http://127.0.0.1:33222";
const actor = "merchant-e2e-actor-a";
const ownStore = "merchant-e2e-own-one";
const secondStore = "merchant-e2e-own-two";
const otherStore = "merchant-e2e-not-owned";

function merchantRequest(cookie, query = "?stores=mine") {
  return new Request(`http://localhost:18102/api/admission${query}`, {
    headers: cookie ? {
      Cookie: `bthwani_merchant_admission=${cookie}`,
      "X-Actor-ID": "merchant-e2e-unrelated-actor",
      "X-Role": "operator",
    } : {},
  });
}

test("real isolated Identity, DSH and Merchant BFF use one verified actor and current owner data", {
  skip: !enabled && "Explicit opt-in requires disposable PostgreSQL, both loopback owners and synthetic roles",
  timeout: 15000,
}, async () => {
  // Deliberately reject any other origin/host; this is never a protected-state test.
  assert.equal(process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN, identity);
  assert.equal(process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN, dsh);
  const merchant = process.env.BTHWANI_MERCHANT_E2E_BEARER;
  const customer = process.env.BTHWANI_MERCHANT_E2E_CUSTOMER_BEARER;
  assert.match(merchant ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(customer ?? "", /^[A-Za-z0-9_-]{43}$/);

  const negative = await GET(merchantRequest(""));
  assert.equal(negative.status, 401);
  assert.equal(negative.headers.get("Cache-Control"), "no-store");

  const invalidQuery = await GET(merchantRequest(merchant, "?stores=mine&actorId=forged"));
  assert.equal(invalidQuery.status, 400);

  const customerResponse = await GET(merchantRequest(customer));
  assert.equal(customerResponse.status, 401, "Customer must never inspect Merchant Store standing");

  const directlyForbidden = await fetch(`${dsh}/v1/stores/mine`, {
    headers: { Authorization: `Bearer ${customer}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(directlyForbidden.status, 403, "DSH must independently deny the Customer role");

  const actual = await GET(merchantRequest(merchant));
  assert.equal(actual.headers.get("Cache-Control"), "no-store");
  if (process.env.BTHWANI_MERCHANT_E2E_REVOKED === "true") {
    assert.equal(actual.status, 401, "revoked Identity Merchant session must fail at BFF");
    assert.match(actual.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
    return;
  }
  assert.equal(actual.status, 200);
  const { standing } = await actual.json();
  assert.equal(standing.actorId, actor);
  const ids = standing.stores.map(store => store.id).sort();
  const expected = process.env.BTHWANI_MERCHANT_E2E_TRANSFERRED === "true"
    ? [secondStore] : [ownStore, secondStore].sort();
  assert.deepEqual(ids, expected, "Store standing must reflect current DSH owner rows");
  assert.ok(!ids.includes(otherStore), "another Merchant's Store must never leak");
});
