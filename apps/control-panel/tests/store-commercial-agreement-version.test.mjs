import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStoreCommercialAgreementVersion } from "../src/features/partner-onboarding/store-commercial-agreement-version.ts";

test("new Store starts with proposal version zero", () => {
  assert.equal(nextStoreCommercialAgreementVersion([]), 0);
});
test("rejected versions preserve monotonically increasing WLT history", () => {
  assert.equal(nextStoreCommercialAgreementVersion([{status: "FINANCE_REJECTED", agreementVersion: 1}]), 1);
  assert.equal(nextStoreCommercialAgreementVersion([{status: "FINANCE_REJECTED", agreementVersion: 2}, {status: "FINANCE_REJECTED", agreementVersion: 1}]), 2);
});
test("a Store with an active contract may propose a replacement without altering the active contract", () => {
  assert.equal(nextStoreCommercialAgreementVersion([{status: "ACTIVE", agreementVersion: 1}]), 1);
  assert.equal(nextStoreCommercialAgreementVersion([
    {status: "SUPERSEDED", agreementVersion: 1},
    {status: "ACTIVE", agreementVersion: 2},
  ]), 2);
  assert.equal(nextStoreCommercialAgreementVersion([
    {status: "SUPERSEDED", agreementVersion: 1},
    {status: "ACTIVE", agreementVersion: 2},
    {status: "FINANCE_REJECTED", agreementVersion: 3},
  ]), 3);
});
test("pending or accepted replacement blocks a competing proposal", () => {
  for (const status of ["PROPOSED", "PARTNER_ACCEPTED"]) {
    assert.equal(nextStoreCommercialAgreementVersion([{status: "ACTIVE", agreementVersion: 1}, {status, agreementVersion: 2}]), null);
    assert.equal(nextStoreCommercialAgreementVersion([{status, agreementVersion: 1}]), null);
  }
});
test("unknown, missing or internally inconsistent agreement history fails closed", () => {
  const invalid = [
    [{status: "FINANCE_REJECTED", agreementVersion: 2}],
    [{status: "ACTIVE", agreementVersion: 0}],
    [{status: "ACTIVE", agreementVersion: 1}, {status: "ACTIVE", agreementVersion: 2}],
    [{status: "SUPERSEDED", agreementVersion: 1}],
    [{status: "FINANCE_REJECTED", agreementVersion: 1}, {status: "ACTIVE", agreementVersion: 1}],
    [{status: "SUPERSEDED", agreementVersion: 2}, {status: "ACTIVE", agreementVersion: 1}],
    [{status: "FORGED", agreementVersion: 1}],
  ];
  for (const agreements of invalid) assert.equal(nextStoreCommercialAgreementVersion(agreements), null);
});
