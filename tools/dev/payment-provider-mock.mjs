#!/usr/bin/env node
// Local-only WireMock scenario switcher and HTTP contract smoke test. No WLT ledger writes.
import assert from "node:assert/strict";

const base = process.env.PAYMENT_MOCK_URL ?? "http://127.0.0.1:18090";
const parsed = new URL(base);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
  throw new Error("PAYMENT_MOCK_URL must point to a loopback-only WireMock API");
}

const mappingId = "00000000-0000-4000-8000-000000000901";
const reference = "{{request.pathSegments.[2]}}";
const allowed = new Set(["success", "failure", "unknown", "delayed", "http500", "timeout", "invalid", "reset", "check"]);

function scenarioMapping(name) {
  const outcome = name === "reset" ? "UNKNOWN" : name.toUpperCase();
  const response = name === "http500"
    ? { status: 503, body: "provider unavailable" }
    : name === "timeout"
      ? { status: 200, fixedDelayMilliseconds: 5000, body: "{}" }
      : name === "invalid"
        ? { status: 200, body: "not-json" }
        : {
          status: 200,
          body: JSON.stringify({
            providerReference: reference,
            outcome,
            providerTransactionReference: name === "success" ? `WM-TXN-${reference}` : "",
            providerFeeMinor: name === "success" ? 37 : 0,
          }),
        };
  return {
    id: mappingId,
    request: { method: "GET", urlPathPattern: "/v1/payments/WM-.+" },
    response: { ...response, headers: { "Content-Type": "application/json" } },
  };
}

async function switchTo(name) {
  const result = await fetch(base + "/__admin/mappings/" + mappingId, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenarioMapping(name)),
    signal: AbortSignal.timeout(4000),
  });
  if (!result.ok) throw new Error(`WireMock Admin returned ${result.status}`);
}

async function createPayment(externalReference) {
  const result = await fetch(base + "/v1/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": externalReference },
    body: JSON.stringify({ intentId: "check-intent", externalReference, amountMinor: 10000, currency: "YER" }),
    signal: AbortSignal.timeout(4000),
  });
  assert.equal(result.status, 201);
  const json = await result.json();
  assert.deepEqual(json, { providerReference: "WM-" + externalReference, state: "PENDING_PROVIDER" });
  return json.providerReference;
}

async function inquiry(ref, expected, opts = {}) {
  const response = await fetch(base + "/v1/payments/" + encodeURIComponent(ref), { signal: AbortSignal.timeout(opts.timeout ?? 4000) });
  assert.equal(response.status, opts.status ?? 200);
  if (expected) {
    const result = await response.json();
    assert.equal(result.providerReference, ref);
    assert.equal(result.outcome, expected);
    assert.equal(result.providerFeeMinor, expected === "SUCCESS" ? 37 : 0);
    if (expected === "SUCCESS") assert.equal(result.providerTransactionReference, "WM-TXN-" + ref);
  }
}

async function check() {
  const ref = await createPayment("contract-" + Date.now());
  assert.equal(await createPayment(ref.slice(3)), ref, "create retry must have a stable reference");
  try {
    for (const outcome of ["unknown", "delayed", "success", "failure"]) {
      await switchTo(outcome);
      await inquiry(ref, outcome.toUpperCase());
      console.log("PASS mock inquiry:", outcome);
    }
    await switchTo("http500");
    await inquiry(ref, null, { status: 503 });
    console.log("PASS provider HTTP error");
    await switchTo("invalid");
    const invalid = await fetch(base + "/v1/payments/" + encodeURIComponent(ref));
    assert.equal(await invalid.text(), "not-json");
    console.log("PASS invalid provider body");
    await switchTo("timeout");
    let timedOut = false;
    try { await inquiry(ref, null, { timeout: 700 }); }
    catch (error) { timedOut = error?.name === "TimeoutError"; }
    assert.equal(timedOut, true, "provider delay must breach bounded timeout");
    console.log("PASS delayed provider timeout");
    console.log("PAYMENT_PROVIDER_MOCK_CONTRACT=PASS");
  } finally {
    await switchTo("reset");
  }
}

const mode = (process.argv[2] ?? "check").toLowerCase();
if (!allowed.has(mode)) throw new Error("Mode: success | failure | unknown | delayed | http500 | timeout | invalid | reset | check");
if (mode === "check") await check();
else {
  await switchTo(mode);
  console.log("Payment mock inquiry scenario:", mode === "reset" ? "unknown" : mode);
}
