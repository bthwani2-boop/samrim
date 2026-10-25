import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStoreImportCsv, summarizeStoreImport } from "../src/features/webmcp/store-import-data.ts";

test("CSV handles Arabic text, quotes, commas and line breaks without losing values", () => {
  const csv = buildStoreImportCsv([{ name: 'حليب,"طازج"\nكبير', priceYER: 250, unit: "COUNT" }]);
  assert.match(csv, /^barcode,name,price,unit,variant\r\n/);
  assert.match(csv, /"حليب,""طازج""\nكبير"/);
  assert.match(csv, /"250","COUNT"/);
});
test("rejects empty, excess and malformed rows before API mutation", () => {
  assert.throws(() => buildStoreImportCsv([]), /1–5000/);
  assert.throws(() => buildStoreImportCsv(Array.from({length:5001},()=>({name:"Milk",priceYER:1}))), /1–5000/);
  assert.throws(() => buildStoreImportCsv([{name:"Milk",priceYER:0}]), /positive/);
  assert.throws(() => buildStoreImportCsv([{name:"Milk",priceYER:1.5}]), /positive/);
  assert.throws(() => buildStoreImportCsv([{name:"Milk",priceYER:1,unit:"LITRE"}]), /unit/);
  assert.throws(() => buildStoreImportCsv([{name:"x",priceYER:1}]), /valid name/);
  assert.throws(() => buildStoreImportCsv([{name:"Milk",priceYER:1,barcode:7}]), /text fields/);
});
test("summaries remain bounded and flag conflicts", () => {
  const result=summarizeStoreImport({run:{id:"r1",state:"previewed",acceptedCount:2,conflictCount:2},items:Array.from({length:100},(_,i)=>({rowNumber:i+2,classification:i%2?"READY":"CONFLICT_EXISTING",errorMessage:"review"}))});
  assert.equal(result.acceptedCount,2);
  assert.equal(result.conflictCount,2);
  assert.equal(result.issues.length,15);
  assert.equal(result.classifications.READY,50);
});
