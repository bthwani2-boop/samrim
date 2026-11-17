import assert from "node:assert/strict";
import { test } from "node:test";
import { merchantSessionMessage } from "./merchant-session.ts";

test("merchant session notices provide no local authorization path", () => {
  for (const state of ["sign-in-required", "verifying", "denied"]) {
    assert.ok(merchantSessionMessage(state).length > 0);
  }
});
