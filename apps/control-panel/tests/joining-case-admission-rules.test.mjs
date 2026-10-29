import assert from "node:assert/strict";
import test from "node:test";
import { canOperatorAdmitJoiningCase } from "../src/features/partner-onboarding/joining-case-admission-rules.ts";

test("verified self-service draft is eligible for Operator admission, but not unilateral approval", () => {
  assert.equal(canOperatorAdmitJoiningCase("self_service", "draft"), true);
  assert.equal(canOperatorAdmitJoiningCase("self_service", "submitted"), false);
  assert.equal(canOperatorAdmitJoiningCase("self_service", "approved"), false);
  assert.equal(canOperatorAdmitJoiningCase("self_service", "needs_correction"), false);
});
test("legacy Operator and Field gates remain distinct", () => {
  assert.equal(canOperatorAdmitJoiningCase("control_panel", "draft"), true);
  assert.equal(canOperatorAdmitJoiningCase("field", "admission_requested"), true);
  assert.equal(canOperatorAdmitJoiningCase("field", "draft"), false);
  assert.equal(canOperatorAdmitJoiningCase("control_panel", "admission_requested"), false);
});
