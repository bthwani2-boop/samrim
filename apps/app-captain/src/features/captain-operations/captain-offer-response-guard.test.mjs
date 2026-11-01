import assert from "node:assert/strict";
import test from "node:test";
import { claimCaptainOfferResponse, isCaptainOfferActionable } from "./captain-offer-response-guard.ts";

test("a second response is rejected until the first response completes", () => {
  const inFlight = new Set();
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), true);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), false);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-2"), false);
  inFlight.delete("offer-1");
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-2"), true);
});

test("only current, unexpired offers may be answered", () => {
  const now = Date.parse("2026-11-01T01:00:00.000Z");
  const future = new Date(now + 1).toISOString();
  const expired = new Date(now - 1).toISOString();
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, now), true);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, now + 1), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: expired }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "accepted", expiresAt: future }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: "invalid" }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, Number.NaN), false);
});
