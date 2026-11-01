import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateOperationsReportMetrics } from "../src/features/operations/operations-report-metrics.ts";

function day(day, orders, delivered = 0, failed = 0, cancelled = 0) {
  return { day, orders, delivered, failed, cancelled, awaitingDispatch: 0,
    inProgress: orders - delivered - failed - cancelled };
}

test("full-period order metrics are calculated only from the complete returned day rows", () => {
  const rows = [day("2026-10-01", 4, 2, 1, 1), day("2026-10-02", 9, 5, 2, 1),
    day("2026-10-03", 0), day("2026-10-04", 9, 7, 0, 1)];
  assert.deepEqual(calculateOperationsReportMetrics(rows), {
    totalOrders: 22, delivered: 14, failed: 3, cancelled: 3,
    averageOrdersPerDay: 5.5, peakDay: "2026-10-02", peakOrders: 9,
  });
});

test("zero-demand dates do not produce a fabricated peak day or average", () => {
  assert.deepEqual(calculateOperationsReportMetrics([]), {
    totalOrders: 0, delivered: 0, failed: 0, cancelled: 0,
    averageOrdersPerDay: null, peakDay: null, peakOrders: 0,
  });
  assert.deepEqual(calculateOperationsReportMetrics([day("2026-10-01", 0)]), {
    totalOrders: 0, delivered: 0, failed: 0, cancelled: 0,
    averageOrdersPerDay: 0, peakDay: null, peakOrders: 0,
  });
});
