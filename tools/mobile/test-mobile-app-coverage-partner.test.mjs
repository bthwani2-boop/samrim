import test from "node:test";

test("app-partner mobile behavioral harness", async () => {
  process.argv[2] = "app-partner";
  await import("./test-mobile-app.mjs");
});
