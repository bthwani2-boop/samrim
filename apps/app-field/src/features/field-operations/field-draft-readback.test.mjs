import assert from "node:assert/strict";
import { test } from "node:test";
import { submitFieldCaseWithReadback } from "./field-draft-readback.ts";

const caseResponse = (state) => ({ case: { id: "case-1", origin: "field", state } });

for (const state of ["admission_requested", "submitted", "approved"]) {
  test(`canonical ${state} readback confirms a recovered submission`, async () => {
    const outcome = await submitFieldCaseWithReadback(
      "case-1",
      async () => { throw Object.assign(new Error("lost response"), { kind: "network" }); },
      async () => caseResponse(state),
      (cause) => cause?.kind === "network",
    );
    assert.equal(outcome.kind, "confirmed");
    if (outcome.kind === "confirmed") assert.equal(outcome.canonical.case.state, state);
  });
}

test("needs_correction readback does not falsely confirm submission", async () => {
  const outcome = await submitFieldCaseWithReadback(
    "case-1",
    async () => { throw Object.assign(new Error("lost response"), { kind: "network" }); },
    async () => caseResponse("needs_correction"),
    (cause) => cause?.kind === "network",
  );
  assert.deepEqual(outcome, { kind: "unconfirmed" });
});
