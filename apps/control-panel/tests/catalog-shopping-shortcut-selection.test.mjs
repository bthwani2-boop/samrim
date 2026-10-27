import assert from "node:assert/strict";
import test from "node:test";
import { retainSelectedCategoryOptions } from "../src/features/central-catalog/catalog-shopping-shortcut-selection.ts";

const option = (id, nameAr = id) => ({ id, nameAr, active: true, pathAr: nameAr });

test("a selected category remains visible across a server search and can then be deselected", () => {
  const firstPage = [option("meat"), option("poultry")];
  let selectedIds = ["meat"];
  let selectedOptions = retainSelectedCategoryOptions([], firstPage, selectedIds);
  assert.deepEqual(selectedOptions.map(({ id }) => id), ["meat"]);

  const searchResults = [option("drinks")];
  selectedOptions = retainSelectedCategoryOptions(selectedOptions, searchResults, selectedIds);
  const visibleChoices = [...new Map([...selectedOptions, ...searchResults].map((item) => [item.id, item])).values()];
  assert.deepEqual(visibleChoices.map(({ id }) => id), ["meat", "drinks"]);
  assert.deepEqual(selectedIds, ["meat"]);

  selectedIds = [];
  selectedOptions = retainSelectedCategoryOptions(selectedOptions, searchResults, selectedIds);
  assert.deepEqual(selectedOptions, []);
});

test("changing the selection drops a previously selected category but retains other selected page results", () => {
  const selectedOptions = [option("meat"), option("poultry")];
  const currentPage = [option("drinks"), option("produce")];

  const nextSelected = retainSelectedCategoryOptions(selectedOptions, currentPage, ["poultry", "produce"]);

  assert.deepEqual(nextSelected.map(({ id }) => id), ["poultry", "produce"]);
});
