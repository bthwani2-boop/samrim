import assert from "node:assert/strict";
import test from "node:test";
import { mergeOrderPageRecords } from "./order-page-records.ts";

test("appending a page retains earlier assignment and offer readbacks", () => {
  const firstPage = { order1: { state: "assigned" } };
  const secondPage = { order2: { state: "in_custody" } };
  assert.deepEqual(mergeOrderPageRecords(firstPage, secondPage, true), { ...firstPage, ...secondPage });
  assert.deepEqual(mergeOrderPageRecords(firstPage, {}, true), firstPage);
  assert.deepEqual(firstPage, { order1: { state: "assigned" } });
});

test("fresh owner readback replaces stale sidecars", () => {
  const previous = { order1: "old", order2: "stale" };
  assert.deepEqual(mergeOrderPageRecords(previous, { order1: "current" }, false), { order1: "current" });
  assert.deepEqual(mergeOrderPageRecords(previous, {}, false), {});
});
