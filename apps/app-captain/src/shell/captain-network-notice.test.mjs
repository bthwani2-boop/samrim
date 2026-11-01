import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootLayout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");
const offlineExpression = rootLayout.match(/offline=\{([^}]+)\}/)?.[1];
assert.ok(offlineExpression, "root network notice supplies its offline state");
const offline = new Function("isConnected", "isInternetReachable", `return (${offlineExpression});`);

test("network notice shows offline for missing internet even while Wi-Fi remains connected", () => {
  assert.equal(offline(true, false), true);
  assert.equal(offline(false, null), true);
  assert.equal(offline(false, false), true);
  assert.equal(offline(true, true), false);
  assert.equal(offline(true, null), false);
  assert.equal(offline(null, null), false);
});
