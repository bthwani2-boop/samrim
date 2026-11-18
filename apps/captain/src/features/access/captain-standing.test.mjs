import assert from "node:assert/strict";
import { test } from "node:test";
import { captainStandingFrom } from "./captain-standing.ts";

test("Captain standing accepts only DSH-approved owner record for exact actor", () => {
  const owner = { actorId: "captain-17", status: "APPROVED", version: 2 };
  assert.equal(captainStandingFrom(owner, "captain-17").status, "APPROVED");
  for (const forged of [
    { ...owner, actorId: "someone-else" },
    { ...owner, status: "PENDING" },
    { ...owner, status: "SUSPENDED" },
    { ...owner, version: 0 },
    { ...owner, anotherField: true },
    { ...owner, actorId: "captain-17\n" },
    null,
  ]) assert.throws(() => captainStandingFrom(forged, "captain-17"));
});
