import assert from "node:assert/strict";
import test from "node:test";
import { executeStaticCoverageOwners } from "../dev/sonar-static-coverage.mjs";

test("app-client mobile behavioral harness", async () => {
  process.argv[2] = "app-client";
  await assert.doesNotReject(() => import("./test-mobile-app.mjs"));
});

test("static verifier owners execute under Sonar coverage", async () => {
  assert.equal(await executeStaticCoverageOwners(), 14);
});
