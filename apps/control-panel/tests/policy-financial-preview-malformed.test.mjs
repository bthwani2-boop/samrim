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

test("noninteger, unsafe or missing captain financial terms never appear as a ready policy", async () => {
  for (const change of [
    { minimumAvailableMinor: "1500" },
    { minimumAvailableMinor: 1500.5 },
    { minimumAvailableMinor: Number.MAX_SAFE_INTEGER + 1 },
    { minimumAvailableMinor: 0 },
    { version: "1" },
    { version: 0 },
    { id: "" },
  ]) {
    const { result } = await readWithResponses({
      [registryUrl]: { status: 200, body: validRegistry },
      [termsUrl]: { status: 200, body: validTerms },
      [captainUrl]: { status: 200, body: { policy: { ...validCaptain.policy, ...change } } },
    });
    assert.equal(result["captain-minimum-balance"].kind, "error", JSON.stringify(change));
    assert.equal(result["delivery-fees"].kind, "ready");
    assert.equal(result["partner-financial-terms"].kind, "ready");
  }
});

test("invalid settlement version or identity stays unconfirmed despite HTTP 200", async () => {
  for (const change of [{ version: "2" }, { version: 0 }, { id: "" }, { id: null }]) {
    const { result } = await readWithResponses({
      [registryUrl]: { status: 200, body: validRegistry },
      [termsUrl]: { status: 200, body: { policy: { ...validTerms.policy, ...change } } },
      [captainUrl]: { status: 200, body: validCaptain },
    });
    assert.equal(result["partner-financial-terms"].kind, "error", JSON.stringify(change));
    assert.equal(result["delivery-fees"].kind, "ready");
    assert.equal(result["captain-minimum-balance"].kind, "ready");
  }
});

test("invalid delivery charges or distance upper bounds cannot appear as canonical prices", async () => {
  for (const band of [
    { upToMeters: -100, ratePerKmMinor: 650 },
    { upToMeters: 0, ratePerKmMinor: 650 },
    { upToMeters: 1000, ratePerKmMinor: -50 },
    { upToMeters: 1000, ratePerKmMinor: 0 },
    { upToMeters: null, ratePerKmMinor: 100.5 },
  ]) {
    const { result } = await readWithResponses({
      [registryUrl]: { status: 200, body: { deliveryTotal: 1, deliveryFees: [{
        ...validRegistry.deliveryFees[0], distanceBands: [band],
      }] } },
      [termsUrl]: { status: 200, body: validTerms },
      [captainUrl]: { status: 200, body: validCaptain },
    });
    assert.equal(result["delivery-fees"].kind, "error", JSON.stringify(band));
    assert.equal(result["partner-financial-terms"].kind, "ready");
    assert.equal(result["captain-minimum-balance"].kind, "ready");
  }
});

test("WLT canonical increasing tiers with final unlimited bound render as one valid fee policy", async () => {
  const { result } = await readWithResponses({
    [registryUrl]: { status: 200, body: {
      deliveryTotal: 1, deliveryFees: [{
        ...validRegistry.deliveryFees[0],
        distanceBands: [
          { upToMeters: 500, ratePerKmMinor: 650 },
          { upToMeters: 2000, ratePerKmMinor: 500 },
          { upToMeters: null, ratePerKmMinor: 350 },
        ],
      }],
    } },
    [termsUrl]: { status: 200, body: validTerms },
    [captainUrl]: { status: 200, body: validCaptain },
  });
  assert.equal(result["delivery-fees"].kind, "ready");
  assert.match(result["delivery-fees"].value.headline, /∞/);
  assert.equal(result["partner-financial-terms"].kind, "ready");
  assert.equal(result["captain-minimum-balance"].kind, "ready");
});

test("invalid WLT band order, terminal bound, upper limit and rate cap do not show as approved prices", async () => {
  const validFinite = { upToMeters: 500, ratePerKmMinor: 650 };
  const invalidBands = [
    [],
    [validFinite],
    [{ upToMeters: null, ratePerKmMinor: 500 }, validFinite],
    [validFinite, { upToMeters: 500, ratePerKmMinor: 500 }, { upToMeters: null, ratePerKmMinor: 350 }],
    [validFinite, { upToMeters: 400, ratePerKmMinor: 500 }, { upToMeters: null, ratePerKmMinor: 350 }],
    [{ upToMeters: 500001, ratePerKmMinor: 650 }, { upToMeters: null, ratePerKmMinor: 350 }],
    [{ upToMeters: 500, ratePerKmMinor: 100000001 }, { upToMeters: null, ratePerKmMinor: 350 }],
    Array.from({ length: 31 }, (_, index) => ({
      upToMeters: index === 30 ? null : (index + 1) * 100,
      ratePerKmMinor: 100,
    })),
  ];
  for (const distanceBands of invalidBands) {
    const { result } = await readWithResponses({
      [registryUrl]: { status: 200, body: { deliveryTotal: 1, deliveryFees: [
        { ...validRegistry.deliveryFees[0], distanceBands },
      ] } },
      [termsUrl]: { status: 200, body: validTerms },
      [captainUrl]: { status: 200, body: validCaptain },
    });
    assert.equal(result["delivery-fees"].kind, "error", JSON.stringify(distanceBands));
    assert.equal(result["partner-financial-terms"].kind, "ready");
    assert.equal(result["captain-minimum-balance"].kind, "ready");
  }
});

test("one stalled owner GET is time-bounded and does not suppress two completed financial previews", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = duration => {
    assert.equal(duration, 12_000, "production GET timeout must remain 12 seconds");
    return originalTimeout(8);
  };
  let abortedByTimeout = false;
  globalThis.fetch = async (url, { signal }) => {
    if (url === registryUrl) {
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          abortedByTimeout = signal.reason?.name === "TimeoutError";
          reject(signal.reason);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return {
      status: 200,
      json: async () => url === termsUrl ? validTerms : validCaptain,
    };
  };
  try {
    const result = await readFinancialPolicyPreviews(new AbortController().signal, true);
    assert.equal(abortedByTimeout, true, "the registry request must use a bounded GET timeout");
    assert.equal(result["delivery-fees"].kind, "error");
    assert.equal(result["partner-financial-terms"].kind, "ready");
    assert.equal(result["captain-minimum-balance"].kind, "ready");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
