import assert from "node:assert/strict";
import test from "node:test";

// Exercise the real owners, not test-only copies of their validation logic.
// Each imported command fails if its own repo state violates the guard.
test("workspace and pinned-source requirements execute", async () => {
  await import("./verify-workspace.mjs");
  assert.equal(process.exitCode ?? 0, 0);
});

test("the three real Expo identity and package manifests validate", async () => {
  await import("../mobile/verify-app-foundations.mjs");
  assert.equal(process.exitCode ?? 0, 0);
});

test("the authored design palette, semantic contrast and CSS projection validate", async () => {
  await import("../../packages/design-system/tools/verify-theme-authority.mjs");
  assert.equal(process.exitCode ?? 0, 0);
});
