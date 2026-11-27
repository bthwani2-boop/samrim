import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerFundingHistory } from "./funding-history.ts";

const id = "funding-boundary";
const stamp = "2026-11-20T00:00:00.123456789Z";
const cursor = Buffer.from(stamp + "|" + id).toString("base64url");
const older = { fundingId: "funding-older", amountYer: "9007199254740993", postedAt: "2026-11-20T00:00:00.123456788Z" };
const page = items => ({ actorId: "customer-one", currency: "YER", items, hasMore: false, nextCursor: null });

test("an immutable funding identity cannot reappear beyond its own keyset boundary", () => {
  assert.deepEqual(parseCustomerFundingHistory(page([older]), cursor), page([older]));
  assert.throws(() => parseCustomerFundingHistory(page([{ ...older, fundingId: id }]), cursor), { status: 502 });
  assert.throws(() => parseCustomerFundingHistory(page([older, { ...older, fundingId: id, postedAt: "2026-11-19T00:00:00Z" }]), cursor), { status: 502 });
  assert.deepEqual(parseCustomerFundingHistory(page([]), cursor), page([]));
});

test("canonical Go cursor precision and ASCII key order survive all fractional widths", () => {
  for (const fraction of ["", ".1", ".12", ".123", ".1234", ".12345", ".123456", ".1234567", ".12345678", ".123456789"]) {
    const postedAt = "2026-11-20T00:00:00" + fraction + "Z";
    const items = Array.from({ length: 10 }, (_, index) => ({ fundingId: "funding-" + (19-index), amountYer: "1", postedAt }));
    const nextCursor = Buffer.from(postedAt + "|" + items.at(-1).fundingId).toString("base64url");
    const current = { ...page(items), hasMore: true, nextCursor };
    assert.deepEqual(parseCustomerFundingHistory(current), current);
    assert.deepEqual(parseCustomerFundingHistory(page([{ ...items.at(-1), fundingId: "funding-09" }]), nextCursor), page([{ ...items.at(-1), fundingId: "funding-09" }]));
  }
});
