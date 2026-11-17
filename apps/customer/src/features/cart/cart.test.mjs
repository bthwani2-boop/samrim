import assert from "node:assert/strict";
import { test } from "node:test";
import { sameCartScope } from "./cart-session.ts";

test("cart scope does not cross actor, session or Store boundaries", () => {
  const cart = { actorId: "a", sessionId: "1", storeId: "s" };
  assert.equal(sameCartScope(cart, { ...cart }), true);
  for (const change of [{ actorId: "b" }, { sessionId: "2" }, { storeId: "other" }]) {
    assert.equal(sameCartScope(cart, { ...cart, ...change }), false);
  }
  assert.equal(sameCartScope(cart, null), false);
});
