import assert from "node:assert/strict";
import { test } from "node:test";
import { readFinanceAgreementPreview } from "../src/features/workspace/operator-home-finance-queue.ts";

const record = {
  agreementId: "agreement-one",
  storeId: "store-one",
  storeName: "متجر",
  status: "PARTNER_ACCEPTED",
  partnerAcceptedAt: "2026-11-01T07:00:00+03:00",
};

test("finance home preview accepts only canonical accepted agreements", () => {
  const items = readFinanceAgreementPreview({ agreements: [record] });
  assert.deepEqual(items, [record]);
  assert.deepEqual(readFinanceAgreementPreview({ agreements: [], nextCursor: "" }), []);
});

test("finance home preview fails closed on malformed or unrelated financial data", () => {
  const invalid = [
    null, [], {}, { agreements: "not a list" }, { agreements: [record, record] },
    { agreements: [record, record, record, record] },
    { agreements: [{ ...record, agreementId: "" }] },
    { agreements: [{ ...record, storeId: "" }] },
    { agreements: [{ ...record, storeName: null }] },
    { agreements: [{ ...record, status: "ACTIVE" }] },
    { agreements: [{ ...record, partnerAcceptedAt: "" }] },
    { agreements: [{ ...record, partnerAcceptedAt: "not-a-date" }] },
  ];
  for (const input of invalid) assert.throws(() => readFinanceAgreementPreview(input), /غير صالحة/);
});
