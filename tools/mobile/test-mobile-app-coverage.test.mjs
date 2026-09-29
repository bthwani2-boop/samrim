import test from "node:test";
import { executeStaticCoverageOwners } from "../dev/sonar-static-coverage.mjs";

test("app-client mobile behavioral harness", async () => {
  process.argv[2] = "app-client";
  await import("./test-mobile-app.mjs");
});

test("static verifier owners execute under Sonar coverage", async () => {
  await executeStaticCoverageOwners();
});
