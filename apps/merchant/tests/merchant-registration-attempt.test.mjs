import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingPendingRegistration, parsePendingRegistration } from "@bthwani/dsh";
import { parseStoredMerchantRegistration, sameRegistrationGeneration } from "../src/features/onboarding/merchant-registration-attempt.ts";

const operationId = "123e4567-e89b-42d3-a456-426614174000";
const fingerprint = "a".repeat(64);
const pending = { fingerprint, operationId };
const saved = JSON.stringify(pending);
const settled = { ...pending, settled: true };

test("legacy opaque Store attempt remains recoverable; settlement is a distinct generation", () => {
  assert.deepEqual(parsePendingRegistration(saved), pending);
  assert.deepEqual(parseStoredMerchantRegistration(saved), pending);
  assert.deepEqual(parseStoredMerchantRegistration(JSON.stringify(settled)), settled);
  assert.equal(matchingPendingRegistration(pending, fingerprint), true);
  assert.equal(matchingPendingRegistration(pending, "b".repeat(64)), false);
  assert.equal(sameRegistrationGeneration(pending, {...pending}), true);
  assert.equal(sameRegistrationGeneration(pending, settled), false);
  assert.equal(sameRegistrationGeneration(null, null), true);
  assert.equal(sameRegistrationGeneration(null, settled), false);
  assert.equal(sameRegistrationGeneration(settled, null), false);
  assert.equal(sameRegistrationGeneration(settled, {...settled, operationId: "123e4567-e89b-42d3-a456-426614174001"}), false);
  assert.equal(sameRegistrationGeneration(settled, {...settled, fingerprint: "b".repeat(64)}), false);
  assert.equal(sameRegistrationGeneration(settled, {...settled}), true);
  assert.equal(parseStoredMerchantRegistration(null), null);
});

test("recovery rejects malformed, inflated, forged or ambiguous metadata", () => {
  const invalid = [
    "", "{", "[]", "null", "{}", JSON.stringify({ ...pending, storeName: "PII" }),
    JSON.stringify({ ...pending, fingerprint: "g".repeat(64) }),
    JSON.stringify({ ...pending, operationId: "not-a-uuid" }),
    JSON.stringify({ ...pending, operationId: "123e4567-e89b-12d3-a456-426614174000" }),
    JSON.stringify({ ...settled, settled: false }), JSON.stringify({ ...settled, extra: true }),
    JSON.stringify({ ...settled, fingerprint: "bad" }),
  ];
  for (const text of invalid) assert.throws(() => parseStoredMerchantRegistration(text));
  assert.ok(!JSON.stringify(settled).includes("storeName") && !JSON.stringify(settled).includes("actorId"));
});
