import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  matchingPendingMerchantRegistration,
  parsePendingMerchantRegistration,
} from "../src/features/onboarding/merchant-registration-attempt.ts";

const operationId = "123e4567-e89b-42d3-a456-426614174000";
const fingerprint = "a".repeat(64);
const saved = JSON.stringify({ fingerprint, operationId });

test("persisted opaque Store registration command can be recovered with identical fingerprint", () => {
  const parsed = parsePendingMerchantRegistration(saved);
  assert.deepEqual(parsed, { fingerprint, operationId });
  assert.equal(matchingPendingMerchantRegistration(parsed, fingerprint), true);
  assert.equal(matchingPendingMerchantRegistration(parsed, "b".repeat(64)), false);
  assert.equal(matchingPendingMerchantRegistration(null, fingerprint), true);
});

test("recovery rejects malformed, inflated, non-v4 or forged retry metadata", () => {
  const invalid = [
    "{", "[]", "null", "{}", JSON.stringify({ fingerprint, operationId, storeName: "PII" }),
    JSON.stringify({ fingerprint: "g".repeat(64), operationId }),
    JSON.stringify({ fingerprint, operationId: "not-a-uuid" }),
    JSON.stringify({ fingerprint, operationId: "123e4567-e89b-12d3-a456-426614174000" }),
  ];
  for (const text of invalid) assert.equal(parsePendingMerchantRegistration(text), null);
  assert.equal(parsePendingMerchantRegistration(null), null);
  assert.ok(!saved.includes("storeName") && !saved.includes("actorId"));
});

test("Merchant form persists the retry ID before owner write and restores it on remount", () => {
  const form = readFileSync(new URL("../src/features/onboarding/merchant-store-registration.tsx", import.meta.url), "utf8");
  assert.match(form, /readStoredAttempt\(actorId\)/);
  assert.match(form, /window\.localStorage/);
  assert.match(form, /SecureStore\.setItemAsync/);
  assert.match(form, /Crypto\.digestStringAsync/);
  assert.ok(form.indexOf("await writeStoredAttempt(actorId, pending)") <
    form.indexOf("const result = await createMerchantStore(actorId, input, controller.signal)"));
  assert.match(form, /matchingPendingMerchantRegistration\(attempt\.current, fingerprint\)/);
  assert.match(form, /setRestored\(true\)/);
  assert.match(form, /await writeStoredAttempt\(actorId, null\)/);
});
