import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { claimCaptainPayoutSubmission } from "./captain-payout-submission-lock.ts";

test("a second payout or finance intake cannot start while an earlier submission is running", () => {
  const lock = { current: false };
  const payout = claimCaptainPayoutSubmission(lock);
  assert.equal(typeof payout, "function");
  assert.equal(claimCaptainPayoutSubmission(lock), null);
  payout();
  const intake = claimCaptainPayoutSubmission(lock);
  assert.equal(typeof intake, "function");
  intake();
  assert.equal(lock.current, false);
});

test("both payout mutations acquire the same synchronous lock and release on exit", () => {
  const source = readFileSync(new URL("./captain-payout-card.tsx", import.meta.url), "utf8");
  const payout = source.slice(source.indexOf("  const request = async ("), source.indexOf("  const requestIntake = async ("));
  const intake = source.slice(source.indexOf("  const requestIntake = async ("), source.indexOf("  const destinationReady ="));
  for (const [name, segment, call] of [
    ["payout", payout, "createOwnPayoutIntent("],
    ["intake", intake, "createOwnSettlementIntake("],
  ]) {
    const reserved = segment.indexOf("claimCaptainPayoutSubmission(financialRequestInFlight)");
    const sent = segment.indexOf(call);
    const released = segment.indexOf("releaseFinancialRequest();", sent);
    assert.ok(reserved >= 0 && sent > reserved && released > sent, `${name} must reserve before sending and release at the end`);
  }
});
