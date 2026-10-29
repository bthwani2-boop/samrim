import assert from "node:assert/strict";
import test from "node:test";
import {
  isJoiningIntakeHoursShape,
  isValidOptionalJoiningWalletProvider,
} from "../src/server/dsh/joining-intake-validation.ts";

test("joining intake accepts omitted or blank wallet provider and rejects malformed values", () => {
  for (const provider of [undefined, "", "   ", "provider-key"]) {
    assert.equal(isValidOptionalJoiningWalletProvider(provider), true, String(provider));
  }
  for (const provider of [null, 15, "unsafe\u0000wallet", "a".repeat(65)]) {
    assert.equal(isValidOptionalJoiningWalletProvider(provider), false, String(provider));
  }
});

test("joining intake accepts empty hours and a valid schedule shape", () => {
  assert.equal(isJoiningIntakeHoursShape([]), true);
  assert.equal(isJoiningIntakeHoursShape([{ dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00", closesNextDay: false }]), true);
  assert.equal(isJoiningIntakeHoursShape([{ dayOfWeek: 7, opensAt: "23:00", closesAt: "02:00", closesNextDay: true }]), true);
});

test("joining intake rejects malformed schedule values before canonical DSH schedule validation", () => {
  for (const hours of [
    null,
    {},
    [{ dayOfWeek: 1, opensAt: "25:00", closesAt: "18:00", closesNextDay: false }],
    [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00", closesNextDay: "false" }],
    [{ dayOfWeek: 8, opensAt: "09:00", closesAt: "18:00", closesNextDay: false }],
  ]) {
    assert.equal(isJoiningIntakeHoursShape(hours), false, JSON.stringify(hours));
  }
});
