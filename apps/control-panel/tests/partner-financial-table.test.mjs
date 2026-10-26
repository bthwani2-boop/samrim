import test from "node:test";
import assert from "node:assert/strict";
import { createTable, getCoreRowModel } from "@tanstack/react-table";
import { Virtualizer } from "@tanstack/react-virtual";

const rows = Array.from({ length: 1000 }, (_, index) => ({
  kind: index % 2 ? "ORDER" : "PAYOUT",
  id: "ref-" + index,
  amountMinor: index * 11,
}));
test("typed ledger table preserves server order and unique composite identity", () => {
  const table = createTable({
    data: rows,
    columns: [{ accessorKey: "id", header: "Reference" }, { accessorKey: "amountMinor", header: "Amount" }],
    getRowId: (item) => item.kind + ":" + item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  const actual = table.getRowModel().rows;
  assert.equal(actual.length, 1000);
  assert.equal(new Set(actual.map((row) => row.id)).size, 1000);
  assert.equal(actual[0].original.id, "ref-0");
  assert.equal(actual[999].original.id, "ref-999");
  assert.equal(actual[999].original.amountMinor, 999 * 11);
});
test("virtual window limits mounted rows for 1000 ledger records", () => {
  const virtual = new Virtualizer({
    count: rows.length,
    getScrollElement: () => null,
    estimateSize: () => 62,
    initialRect: { width: 1024, height: 700 },
    initialOffset: 0,
    overscan: 8,
    scrollToFn: () => {},
    observeElementRect: () => () => {},
    observeElementOffset: () => () => {},
  });
  assert.ok(virtual.getVirtualItems().length > 0);
  assert.ok(virtual.getVirtualItems().length < 50);
  assert.equal(virtual.getTotalSize(), rows.length * 62);
});
