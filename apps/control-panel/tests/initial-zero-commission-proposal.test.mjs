import assert from "node:assert/strict";
import { test } from "node:test";
import { initialZeroCommissionProposalVersion } from "../src/features/partner-onboarding/initial-zero-commission-proposal.ts";

test("initial Store may propose the first zero-product-commission agreement", () => {
  assert.equal(initialZeroCommissionProposalVersion([]), 0);
});
test("rejected versions may be corrected and reproposed without losing their WLT history", () => {
  assert.equal(initialZeroCommissionProposalVersion([{status: "FINANCE_REJECTED", agreementVersion: 1}]), 1);
  assert.equal(initialZeroCommissionProposalVersion([{status: "FINANCE_REJECTED", agreementVersion: 2}, {status: "FINANCE_REJECTED", agreementVersion: 1}]), 2);
});
test("pending, accepted, active, superseded, malformed, or missing history prevents another initial proposal", () => {
  for(const status of ["PROPOSED", "PARTNER_ACCEPTED", "ACTIVE", "SUPERSEDED"]) {
    assert.equal(initialZeroCommissionProposalVersion([{status, agreementVersion: 1}]), null);
  }
  assert.equal(initialZeroCommissionProposalVersion([{status:"FINANCE_REJECTED",agreementVersion:1},{status:"ACTIVE",agreementVersion:2}]), null);
  assert.equal(initialZeroCommissionProposalVersion([{status:"FINANCE_REJECTED",agreementVersion:1},{status:"FINANCE_REJECTED",agreementVersion:1}]), null);
  assert.equal(initialZeroCommissionProposalVersion([{status:"FINANCE_REJECTED",agreementVersion:2}]), null);
  assert.equal(initialZeroCommissionProposalVersion([{status:"FINANCE_REJECTED",agreementVersion:0}]), null);
});