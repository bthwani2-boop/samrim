import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogActivityDateBound, validCatalogActivityDay } from "./partner-catalog-activity-date.ts";

test("Aden calendar dates are accepted regardless of their preceding UTC day", () => {
  for (const day of ["2026-11-01", "2026-01-01", "2024-02-29", "2026-12-31"]) {
    assert.equal(validCatalogActivityDay(day), true, day);
  }
  assert.equal(validCatalogActivityDay(""), true);
});

test("invalid and normalized calendar dates are rejected", () => {
  for (const day of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-1", "random"]) {
    assert.equal(validCatalogActivityDay(day), false, day);
  }
});

test("DSH date bounds cover an entire Aden day with an exclusive upper bound", () => {
  assert.equal(catalogActivityDateBound("2026-11-01", false), "2026-10-31T21:00:00.000Z");
  assert.equal(catalogActivityDateBound("2026-11-01", true), "2026-11-01T21:00:00.000Z");
  assert.equal(catalogActivityDateBound("2024-02-29", true), "2024-02-29T21:00:00.000Z");
  assert.equal(catalogActivityDateBound("", true), "");
});
