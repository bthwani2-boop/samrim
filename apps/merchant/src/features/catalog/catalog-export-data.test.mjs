import assert from "node:assert/strict";
import { test } from "node:test";
import { collectCatalogExport } from "./catalog-export-data.ts";

const offer = (id, name = "قهوة يمنية") => ({
  id, storeId: "store-a", productId: "product-"+id, name, variantId: "variant-"+id,
  priceYer: "9223372036854775807", stockUnits: 2, draftVersion: 3,
  productActive: false, variantSellable: false, requiredAttributesValid: false,
  published: false, available: false,
});
const page = (items, nextCursor) => ({ actorId: "merchant-a", storeId: "store-a", items,
  ...(nextCursor ? { nextCursor } : {}) });
const run = (read, signal = new AbortController().signal) =>
  collectCatalogExport("merchant-a", "store-a", signal, read);

test("export reads fresh owner pages and preserves exact YER and draft status", async () => {
  const calls = [];
  const result = await run(async (storeId, actorId, signal, options) => {
    assert.equal(storeId, "store-a");
    assert.equal(actorId, "merchant-a");
    assert.equal(signal.aborted, false);
    calls.push(options);
    return options.cursor ? page([offer("of-b", 'شاي, "عدني"')]) :
      page(Array.from({length: 50}, (_, i) => offer("of-a"+String(i).padStart(2,"0"))), "of-a49");
  });
  assert.deepEqual(calls, [{limit:50}, {limit:50,cursor:"of-a49"}]);
  assert.equal(result.count, 51);
  assert.match(result.csv, /^\uFEFF/);
  assert.match(result.csv, /9223372036854775807/);
  assert.match(result.csv, /"شاي, ""عدني"""/);
  assert.match(result.csv, /"false","false"/);
  assert.doesNotMatch(result.csv, /merchant-a/);
});

test("filtered export sends the same owner selectors on every page, never just loaded rows", async () => {
  const calls = [];
  const items = Array.from({ length: 50 }, (_, i) => ({ ...offer("of-a" + String(i).padStart(2, "0")), published: true, stockUnits: 0 }));
  const last = { ...offer("of-b"), published: true, stockUnits: 0 };
  const result = await collectCatalogExport("merchant-a", "store-a", new AbortController().signal,
    async (_store, _actor, _signal, options) => {
      calls.push(options);
      return options.cursor ? page([last]) : page(items, "of-a49");
    }, { query: "قهوة", status: "stockout" });
  assert.deepEqual(calls, [
    { limit: 50, query: "قهوة", status: "stockout" },
    { limit: 50, cursor: "of-a49", query: "قهوة", status: "stockout" },
  ]);
  assert.equal(result.count, 51);
  assert.match(result.csv, /of-b/);
});

test("formula-like names and identifiers are escaped as spreadsheet text", async () => {
  const result = await run(async () => page([
    {...offer("of-a", "  =1+2"), productId: "@SUM(1)"},
    offer("of-b", "\t-2+3"), offer("of-c", "＋1"),
  ]));
  assert.match(result.csv, /"' {2}=1\+2"/);
  assert.match(result.csv, /"'@SUM\(1\)"/);
  assert.match(result.csv, /"'\t-2\+3"/);
  assert.match(result.csv, /"'＋1"/);
});

test("foreign scope, reversed or repeated page, denial and abort never return partial export", async () => {
  const first = page(Array.from({length:50}, (_, i) => offer("of-a"+String(i).padStart(2,"0"))), "of-a49");
  for (const next of [
    {...page([offer("of-b")]), actorId:"merchant-b"},
    {...page([offer("of-b")]), storeId:"store-b"},
    page([{...offer("of-b"), storeId:"store-b"}]),
    page([offer("of-a49")]),
    page([offer("of-c"),offer("of-b")]),
  ]) {
    await assert.rejects(run(async (_s,_a,_signal,opts) => opts.cursor ? next : first));
  }
  await assert.rejects(run(async (_s,_a,_signal,opts) => {
    if(opts.cursor) throw new Error("403");
    return first;
  }), /403/);
  const controller = new AbortController();
  await assert.rejects(run(async () => { controller.abort(); return first; }, controller.signal));
});

test("zero records produces headers only; more than 5000 is rejected without partial file", async () => {
  assert.equal((await run(async () => page([]))).count, 0);
  let calls = 0;
  await assert.rejects(run(async () => {
    const items = Array.from({length:50}, (_, i) => offer("of-"+String(calls*50+i).padStart(5,"0")));
    calls++;
    return page(items, items.at(-1).id);
  }), /CATALOG_EXPORT_LIMIT/);
  assert.equal(calls, 100);
});

test("draft-edit CSV round trips exact values and excludes ambiguous or unsafe offers", async () => {
  const { previewCatalogCsv, reviewCatalogImportRows, buildImportManifest } = await import("./catalog-import-data.ts");
  const items = [
    { ...offer("of-a", 'coffee, "Yemen"'), stockUnits: 0 },
    offer("of-b", "Café"), { ...offer("of-c", "Cafe\u0301"), published: true },
    offer("of-d", " =1+2"), offer("of-e", "＋1"), offer("of-f", "invalid\uFFFD"),
    { ...offer("of-g", "active"), productActive: true },
    { ...offer("of-h", "invalid amount"), priceYer: "0" },
    { ...offer("of-i", "stale"), draftVersion: Number.MAX_SAFE_INTEGER },
    offer("of-j", " leading "), offer("of-k", "tea"),
  ];
  const calls = [];
  const signal = new AbortController().signal;
  const read = async (_s,_a,_signal,opts) => { calls.push(opts); return page(items); };
  const result = await collectCatalogExport("merchant-a","store-a",signal,read,{query:"ignored"},"draft-edit");
  assert.deepEqual(calls,[{limit:50}],"template must examine complete Store");
  assert.equal(result.count,2);
  assert.equal(result.excluded,9);
  const parsed = previewCatalogCsv(result.csv);
  assert.deepEqual(parsed.map(r=>[r.name,r.priceYer,r.stockUnits]),[
    ['coffee, "Yemen"',"9223372036854775807","0"],["tea","9223372036854775807","2"],
  ]);
  const reviewed = await reviewCatalogImportRows(parsed,"merchant-a","store-a",signal,read);
  assert.deepEqual(reviewed.map(r=>r.editableDraft?.id),["of-a","of-k"]);
  const manifest=buildImportManifest(reviewed,"a".repeat(64),new Set(reviewed.map(r=>r.row)));
  assert.deepEqual(manifest.rows.map(r=>[r.offerId,r.expectedVersion]),[["of-a",3],["of-k",3]]);
  await assert.rejects(collectCatalogExport("merchant-a","store-a",signal,async()=>page(items.slice(1,10)),{},"draft-edit"),/CATALOG_IMPORT_TEMPLATE_EMPTY/);
  await assert.rejects(collectCatalogExport("merchant-a","store-a",signal,async()=>{throw Error("403");},{},"draft-edit"),/403/);
});
