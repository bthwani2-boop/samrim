import assert from "node:assert/strict";
import test from "node:test";
import { buildCategoryListParams, isLoadedViewSort, sortTaxonomyRows } from "../src/features/central-catalog/catalog-taxonomy-query.ts";

test("category list queries carry the selected server sort on first and cursor pages", () => {
  const queryName = "\u0634\u0627\u064a";
  const asc = buildCategoryListParams({ verticalId: "vertical-1", query: `  ${queryName}  `, status: "active", sort: "name_asc" });
  assert.equal(asc.get("sort"), "name_asc");
  assert.equal(asc.get("verticalId"), "vertical-1");
  assert.equal(asc.get("query"), queryName);
  assert.equal(asc.get("status"), "active");
  assert.equal(asc.has("cursor"), false);

  const ascNext = buildCategoryListParams({ verticalId: "vertical-1", query: queryName, status: "active", sort: "name_asc", cursor: "cursor-asc" });
  assert.equal(ascNext.get("sort"), "name_asc");
  assert.equal(ascNext.get("cursor"), "cursor-asc");
  assert.equal(ascNext.get("query"), asc.get("query"));
  assert.equal(ascNext.get("status"), asc.get("status"));

  const desc = buildCategoryListParams({ verticalId: "vertical-1", query: queryName, status: "active", sort: "name_desc" });
  const descNext = buildCategoryListParams({ verticalId: "vertical-1", query: queryName, status: "active", sort: "name_desc", cursor: "cursor-desc" });
  assert.equal(desc.get("sort"), "name_desc");
  assert.equal(descNext.get("sort"), desc.get("sort"));
  assert.equal(descNext.get("cursor"), "cursor-desc");
  assert.equal(descNext.get("query"), desc.get("query"));
  assert.equal(descNext.get("status"), desc.get("status"));
});

test("category rows keep canonical server order while mixed loaded rows sort only their subset", () => {
  const serverOrdered = [{ id: "a", nameAr: "\u0623\u0644\u0641" }, { id: "b", nameAr: "\u0628\u0627\u0621" }];
  const categoryRows = sortTaxonomyRows(serverOrdered, "name_desc", "category");
  assert.equal(categoryRows, serverOrdered);
  assert.deepEqual(categoryRows.map((row) => row.id), ["a", "b"]);

  const mixedRows = [{ id: "a", nameAr: "\u0623\u0644\u0641" }, { id: "b", nameAr: "\u0628\u0627\u0621" }];
  const loadedDesc = sortTaxonomyRows(mixedRows, "name_desc", "all");
  assert.deepEqual(loadedDesc.map((row) => row.id), ["b", "a"]);
  assert.notEqual(loadedDesc, mixedRows);
  assert.equal(isLoadedViewSort("all", true), true);
  assert.equal(isLoadedViewSort("all", false), false);
  assert.equal(isLoadedViewSort("category", true), false);
  assert.equal(isLoadedViewSort("type", true), false);
});