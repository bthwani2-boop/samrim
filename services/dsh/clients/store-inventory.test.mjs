import assert from "node:assert/strict";
import { test } from "node:test";
import { scopedCatalogInventorySummary } from "./store-inventory.ts";

const base={summary:{storeId:"store-a",totalOffers:110,publishedOffers:108,availableOffers:102,unavailableOffers:6,stockoutOffers:4}};
test("whole-store inventory counts are accepted only for the requested Store",()=>{
 assert.equal(scopedCatalogInventorySummary(base,"store-a")?.totalOffers,110);
 assert.equal(scopedCatalogInventorySummary(base,"store-b"),null);
 assert.equal(scopedCatalogInventorySummary({summary:{...base.summary,storeId:""}},"store-a"),null);
});
test("invalid, partial and inconsistent inventory counts fail closed",()=>{
 for(const payload of [
  null,{summary:null},{summary:{...base.summary,stockoutOffers:7}},
  {summary:{...base.summary,publishedOffers:109}},
  {summary:{...base.summary,totalOffers:20}},
  {summary:{...base.summary,availableOffers:102.5}},
  {summary:{...base.summary,unavailableOffers:-1}},
  {summary:{...base.summary,stockoutOffers:null}},
 ]) assert.equal(scopedCatalogInventorySummary(payload,"store-a"),null);
});
