import assert from "node:assert/strict";
import test from "node:test";

test("app-client mobile behavioral harness", async () => {
  process.argv[2] = "app-client";
  await assert.doesNotReject(() => import("./test-mobile-app.mjs"));
});
