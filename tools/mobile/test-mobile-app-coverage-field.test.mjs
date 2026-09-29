import test from "node:test";

test("app-field mobile behavioral harness", async () => {
  process.argv[2] = "app-field";
  await import("./test-mobile-app.mjs");
});
