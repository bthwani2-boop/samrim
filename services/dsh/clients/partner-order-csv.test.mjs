import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTNER_ORDER_REPORT_MAX_ROWS,
  PARTNER_ORDER_REPORT_PAGE_SIZE,
  collectPartnerOrderReportCsv,
  buildPartnerOrderReportCsv,
} from "./partner-order-csv.ts";

const item = (n, storeId = "store-1") => ({
  id: "order-" + n,
  storeId,
  state: "DELIVERED",
  createdAt: "2026-10-31T12:00:00Z",
  fulfillmentMode: "CUSTOMER_PICKUP",
  totalAmountMinor: 100 + n,
});

test("all DSH cursor pages beyond 2000 orders are included in a UTF-8 CSV", async () => {
  const source = Array.from({ length: 2001 }, (_, i) => item(i));
  let calls = 0;
  const out = await collectPartnerOrderReportCsv("store-1", async cursor => {
    calls++;
    const start = cursor ? Number(cursor) : 0;
    const orders = source.slice(start, start + PARTNER_ORDER_REPORT_PAGE_SIZE);
    return {orders, nextCursor: start + orders.length < source.length ? String(start + orders.length) : ""};
  });
  assert.equal(out.count, 2001);
  assert.equal(calls, 41);
  assert.equal(out.csv[0], "\uFEFF");
  assert.equal(out.csv.split("\r\n").length, 2002);
  assert.ok(out.csv.includes('"order-2000"'));
  assert.ok(!out.csv.includes("clientActorId"));
});

test("a spreadsheet formula or embedded quote is rendered harmless", () => {
  const csv = buildPartnerOrderReportCsv([{...item(1), id: "=SUM(1,2)", state: '-"evil"'}]);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'-""evil"""'));
});

test("foreign store and duplicate order fail closed", async () => {
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () =>
    ({ orders:[item(1, "store-2")], nextCursor:"" })), /ORDER_REPORT_SCOPE_OR_DUPLICATE/);
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () =>
    ({ orders:[item(1), item(1)], nextCursor:"" })), /ORDER_REPORT_SCOPE_OR_DUPLICATE/);
});

test("interrupted reads, repeated cursors and empty intermediate pages refuse partial data", async () => {
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () => { throw new Error("network-offline"); }), /network-offline/);
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () =>
    ({ orders: [], nextCursor:"more" })), /ORDER_REPORT_TOO_LARGE_OR_INCONSISTENT/);
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async cursor =>
    ({ orders: [item(cursor ? 2 : 1)], nextCursor:"repeat" })), /ORDER_REPORT_CURSOR_REPEATED/);
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () =>
    ({ orders: null, nextCursor:"" })), /ORDER_REPORT_RESPONSE_INVALID/);
});

test("safety limit never returns an incomplete report", async () => {
  let offset = 0;
  await assert.rejects(collectPartnerOrderReportCsv("store-1", async () => {
    const current = offset;
    offset += PARTNER_ORDER_REPORT_PAGE_SIZE;
    return {
      orders: Array.from({ length: PARTNER_ORDER_REPORT_PAGE_SIZE }, (_, i) => item(current + i)),
      nextCursor: String(offset),
    };
  }), /ORDER_REPORT_TOO_LARGE_OR_INCONSISTENT/);
  assert.ok(offset >= PARTNER_ORDER_REPORT_MAX_ROWS);
});
