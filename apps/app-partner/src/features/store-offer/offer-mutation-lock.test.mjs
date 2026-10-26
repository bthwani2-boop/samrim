import assert from "node:assert/strict";
import test from "node:test";
import { acquireOfferMutation } from "./offer-mutation-lock.ts";

test("a second publish submission is rejected until the first request settles", () => {
  const lock = { current: false };
  const first = acquireOfferMutation(lock);
  const duplicate = acquireOfferMutation(lock);

  assert.equal(typeof first, "function");
  assert.equal(duplicate, null);
  first();
  assert.equal(typeof acquireOfferMutation(lock), "function");
});
