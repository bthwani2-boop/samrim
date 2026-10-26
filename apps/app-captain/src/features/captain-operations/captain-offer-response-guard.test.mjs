import assert from "node:assert/strict";
import test from "node:test";
import { claimCaptainOfferResponse } from "./captain-offer-response-guard.ts";

test("a second response for the same offer is rejected until the first completes", () => {
  const inFlight = new Set();
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), true);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), false);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-2"), true);
});
