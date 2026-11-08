import assert from "node:assert/strict";
import { test } from "node:test";
import { readFinancialPolicyPreviews } from "../src/features/policies/policy-financial-preview.ts";

const registryUrl = "/api/finance/policy-registry";
const termsUrl = "/api/finance/partner-financial-terms-policy";
const captainUrl = "/api/finance/captain-minimum-balance-policy";
const validTerms = { policy: {
  id: "terms-1", settlementPeriod: "WEEKLY", version: 2,
  createdBy: "operator-a", createdAt: "2026-11-08T00:00:00Z",
} };
const validCaptain = { policy: {
  id: "captain-1", state: "ACTIVE", currency: "YER", minimumAvailableMinor: 1500,
  version: 1, createdAt: "2026-11-08T00:00:00Z", createdBy: "operator-a",
} };
const validRegistry = { deliveryTotal: 1, deliveryFees: [{
  id: "", name: "تعرفة عامة", version: 1, createdBy: "operator-a",
  createdAt: "2026-11-08T00:00:00Z",
  distanceBands: [{ upToMeters: null, ratePerKmMinor: 650 }],
}] };

async function readWithResponses(replies, canReadTerms = true) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    if (!(url in replies)) throw new Error("Unexpected request: " + url);
    const reply = replies[url];
    if (reply instanceof Error) throw reply;
    return { status: reply.status, json: async () => reply.body };
  };
  try {
    const result = await readFinancialPolicyPreviews(new AbortController().signal, canReadTerms);
    return { result, requests };
  } finally {
    globalThis.fetch = original;
  }
}

test("null financial owner JSON cannot reject the entire policy registry read", async () => {
  const { result } = await readWithResponses({
    [registryUrl]: { status: 200, body: null },
    [termsUrl]: { status: 200, body: null },
    [captainUrl]: { status: 200, body: null },
  });
  assert.equal(result["delivery-fees"].kind, "error");
  assert.equal(result["partner-financial-terms"].kind, "error");
  assert.equal(result["captain-minimum-balance"].kind, "error");
});

test("malformed WLT delivery bands fail only the delivery summary, preserving other financial cards", async () => {
  const { result } = await readWithResponses({
    [registryUrl]: { status: 200, body: {
      deliveryTotal: 1, deliveryFees: [{ ...validRegistry.deliveryFees[0], distanceBands: null }],
    } },
    [termsUrl]: { status: 200, body: validTerms },
    [captainUrl]: { status: 200, body: validCaptain },
  });
  assert.equal(result["delivery-fees"].kind, "error");
  assert.equal(result["partner-financial-terms"].kind, "ready");
  assert.match(result["partner-financial-terms"].value.headline, /أسبوعية/);
  assert.equal(result["captain-minimum-balance"].kind, "ready");
});

test("valid canonical owner summaries still render the original rates and missing states", async () => {
  const { result, requests } = await readWithResponses({
    [registryUrl]: { status: 200, body: validRegistry },
    [termsUrl]: { status: 200, body: validTerms },
    [captainUrl]: {
      status: 404, body: { error: { code: "CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED" } },
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(result["delivery-fees"].kind, "ready");
  assert.match(result["delivery-fees"].value.headline, /عام:/);
  assert.equal(result["delivery-fees"].value.records.length, 1);
  assert.equal(result["partner-financial-terms"].kind, "ready");
  assert.equal(result["captain-minimum-balance"].kind, "missing");
});

test("revoked finance permission skips partner term GET without losing non-finance states", async () => {
  const { result, requests } = await readWithResponses({
    [registryUrl]: { status: 200, body: { deliveryTotal: 0, deliveryFees: [] } },
    [captainUrl]: { status: 404, body: null },
  }, false);
  assert.equal(requests.length, 2);
  assert.equal(requests.some(item => item.url === termsUrl), false);
  assert.equal(result["delivery-fees"].kind, "ready");
  assert.equal(result["partner-financial-terms"].kind, "restricted");
  assert.equal(result["captain-minimum-balance"].kind, "error");
});

test("malformed fee rows and unavailable owner produce scoped recoverable errors", async () => {
  for (const invalid of [
    { deliveryTotal: -1, deliveryFees: [] },
    { deliveryTotal: 1, deliveryFees: [null] },
    { deliveryTotal: 1, deliveryFees: [{ ...validRegistry.deliveryFees[0], distanceBands: [null] }] },
    { deliveryTotal: 1, deliveryFees: [{ ...validRegistry.deliveryFees[0], distanceBands: [{ upToMeters: null, ratePerKmMinor: "650" }] }] },
  ]) {
    const { result } = await readWithResponses({
      [registryUrl]: { status: 200, body: invalid },
      [termsUrl]: { status: 404, body: null },
      [captainUrl]: { status: 200, body: validCaptain },
    });
    assert.equal(result["delivery-fees"].kind, "error");
    assert.equal(result["partner-financial-terms"].kind, "missing");
    assert.equal(result["captain-minimum-balance"].kind, "ready");
  }
  const { result } = await readWithResponses({
    [registryUrl]: new Error("WLT temporarily unavailable"),
    [termsUrl]: { status: 200, body: validTerms },
    [captainUrl]: { status: 200, body: validCaptain },
  });
  assert.equal(result["delivery-fees"].kind, "error");
  assert.equal(result["partner-financial-terms"].kind, "ready");
  assert.equal(result["captain-minimum-balance"].kind, "ready");
});
