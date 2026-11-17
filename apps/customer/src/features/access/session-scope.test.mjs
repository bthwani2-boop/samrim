import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthReturnPath } from "./auth-return-path.ts";
import { sameSessionScope } from "./session-scope.ts";

test("actor and session must both match before reusing session-bound state", () => {
  const scope = { actorId: "customer-1", sessionId: "session-1" };
  assert.equal(sameSessionScope(scope, { ...scope }), true);
  assert.equal(sameSessionScope(scope, { ...scope, actorId: "customer-2" }), false);
  assert.equal(sameSessionScope(scope, { ...scope, sessionId: "session-2" }), false);
  assert.equal(sameSessionScope(scope, null), false);
});
test("login return paths never accept external URLs or traversal", () => {
  assert.equal(safeAuthReturnPath("/orders"), "/orders");
  for (const value of ["//evil.test", "https://evil.test", "/../account", "/%2f%2fevil", "/\\evil", null]) {
    assert.equal(safeAuthReturnPath(value), "/");
  }
});
