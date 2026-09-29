import test from "node:test";

test("app-captain mobile behavioral harness", async () => {
  process.argv[2] = "app-captain";
  await import("./test-mobile-app.mjs");
});
