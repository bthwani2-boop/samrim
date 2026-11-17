import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { onboardingRecoveryMessage } from "./onboarding-recovery.ts";

test("onboarding recovery remains guidance-only", () => {
  for (const reason of ["identity", "store-review", "authorization"]) {
    assert.ok(onboardingRecoveryMessage(reason).length > 0);
  }
});
test("onboarding presentation modules exist", () => {
  for (const file of ["merchant-application.tsx", "store-relation-choice.tsx", "store-setup-screen.tsx"]) {
    assert.ok(existsSync(resolve(import.meta.dirname, file)), file);
  }
});
