import assert from "node:assert/strict";
import test from "node:test";
import { isClientActorScopeCurrent, isClientOrderScopeCurrent } from "./order-session-scope.ts";

test("order detail may only be displayed to the loading actor for the requested order", () => {
  assert.equal(isClientOrderScopeCurrent("actor-a", "order-1", "actor-a", "order-1"), true);
  assert.equal(isClientOrderScopeCurrent("actor-a", "order-1", "actor-b", "order-1"), false);
  assert.equal(isClientOrderScopeCurrent("actor-a", "order-1", "", "order-1"), false);
  assert.equal(isClientOrderScopeCurrent("actor-a", "order-1", "actor-a", "order-2"), false);
  assert.equal(isClientOrderScopeCurrent("", "order-1", "", "order-1"), false);
  assert.equal(isClientOrderScopeCurrent("actor-a", "", "actor-a", ""), false);
});

test("orders list never reuses previous actor cached rows", () => {
  assert.equal(isClientActorScopeCurrent("actor-a", "actor-a"), true);
  assert.equal(isClientActorScopeCurrent("actor-a", "actor-b"), false);
  assert.equal(isClientActorScopeCurrent("actor-a", ""), false);
  assert.equal(isClientActorScopeCurrent("", ""), false);
});
