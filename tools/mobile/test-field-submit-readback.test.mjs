import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldSubmitIdempotencyPayload, submitFieldCaseWithReadback } from "../../apps/app-field/src/features/field-operations/field-draft-readback.ts";

const caseResponse = (state = "admission_requested", id = "case-1", origin = "field") => ({ case: { id, origin, state } });
const uncertain = (cause) => cause?.kind === "network" || (cause?.status ?? 0) >= 500;

test("Field submit idempotency identity is stable across entry points and changes by case/version", () => {
  const attempt = fieldSubmitIdempotencyPayload("case-1", 3);
  assert.equal(attempt, "field-submit:case-1:3");
  assert.equal(fieldSubmitIdempotencyPayload("case-1", 3), attempt);
  assert.notEqual(fieldSubmitIdempotencyPayload("case-1", 4), attempt);
  assert.notEqual(fieldSubmitIdempotencyPayload("case-2", 3), attempt);
});

test("a lost submission response resolves from the canonical DSH state without replaying the mutation", async () => {
  let submissions = 0;
  let reads = 0;
  const result = await submitFieldCaseWithReadback("case-1", async () => {
    submissions++;
    throw { kind: "network" };
  }, async () => {
    reads++;
    return caseResponse();
  }, uncertain);
  assert.equal(result.kind, "confirmed");
  assert.equal(result.canonical?.case.state, "admission_requested");
  assert.equal(submissions, 1);
  assert.equal(reads, 1);
});

test("a still-draft readback never claims success", async () => {
  const result = await submitFieldCaseWithReadback("case-1", async () => {}, async () => caseResponse("draft"), uncertain);
  assert.equal(result.kind, "draft");
});

test("unavailable, mismatched and unrelated readbacks never claim success", async () => {
  for (const read of [
    async () => { throw new Error("unavailable"); },
    async () => caseResponse("admission_requested", "case-2"),
    async () => caseResponse("admission_requested", "case-1", "control_panel"),
  ]) {
    const result = await submitFieldCaseWithReadback("case-1", async () => {}, read, uncertain);
    assert.equal(result.kind, "unconfirmed");
  }
});

test("an explicit rejected submission is not mistaken for a network timeout", async () => {
  let reads = 0;
  await assert.rejects(
    () => submitFieldCaseWithReadback("case-1", async () => { throw new Error("INVALID_INPUT"); }, async () => {
      reads++;
      return caseResponse();
    }, uncertain),
    /INVALID_INPUT/,
  );
  assert.equal(reads, 0);
});
