import test from "node:test";

test("app-client mobile behavioral harness", async () => {
  process.argv[2] = "app-client";
  await import("./test-mobile-app.mjs");
});
