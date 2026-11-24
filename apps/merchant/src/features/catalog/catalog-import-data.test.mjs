import assert from "node:assert/strict";
import { test } from "node:test";
import { csvPreviewByteLimit, previewCatalogCsv, readCatalogCsv, reviewCatalogImportRows } from "./catalog-import-data.ts";

const header = "name,price_yer,stock_units\n";
test("CSV preview preserves exact integer YER, UTF-8 BOM, quoted commas and zero stock", () => {
  const rows = previewCatalogCsv("\uFEFFname,price_yer,stock_units\r\n\"شاي, \"\"عدني\"\"\",9223372036854775807,0\r\nقهوة,1000,2\r\n");
  assert.deepEqual(rows, [
    { row: 2, name: 'شاي, "عدني"', priceYer: "9223372036854775807", stockUnits: "0", reason: "owner-review" },
    { row: 3, name: "قهوة", priceYer: "1000", stockUnits: "2", reason: "owner-review" },
  ]);
});
test("invalid rows and duplicate names remain held without discarding valid rows", () => {
  const rows = previewCatalogCsv(header + "قهوة,500,2\n قهوة ,600,3\nعصير,0,1\nشاي,2.5,1\nماء,50,-1\nزيت,9223372036854775808,1\nسكر,50,2147483648\nخبز,40,1\nناقص,30");
  assert.deepEqual(rows.map(r => r.reason), ["duplicate-name","duplicate-name","invalid","invalid","invalid","invalid","invalid","owner-review","invalid"]);
});
test("record numbering preserves blanks and holds extra fields without dropping valid records", () => {
  const rows = previewCatalogCsv(header + "قهوة,1,0,extra,extra\n\nشاي,2,0");
  assert.deepEqual(rows.map(({ row, reason }) => [row, reason]), [[2,"invalid"], [3,"invalid"], [4,"owner-review"]]);
  assert.throws(() => previewCatalogCsv('"name,price_yer",stock_units\nx,1'), /CSV_HEADER/);
  assert.throws(() => previewCatalogCsv(header + 'x"y,1,0'), /CSV_FORMAT/);
});

test("ambiguous headers, malformed quoting, empty inputs and overflow reject the whole local preview", () => {
  for (const text of ["", "name,name,stock_units\nقهوة,50,1", header, header + '"bad,50,1', header + '"bad"x,50,1', header + "x\u0000,50,1", header + "x,50,1\rnext,50,1"]) {
    assert.throws(() => previewCatalogCsv(text));
  }
  const rows = Array.from({length:5000}, (_, i) => `product-${i},1,0`).join("\n");
  assert.equal(previewCatalogCsv(header+rows).length, 5000);
  assert.throws(() => previewCatalogCsv(header+rows+"\nextra,1,0"), /CSV_LIMIT/);
});

test("bounded file reader preserves UTF-8, rejects inconsistent size and never reads oversized files", async () => {
  const signal = new AbortController().signal;
  const csv = header + "قهوة,1200,5";
  assert.equal(await readCatalogCsv(new Blob([csv]), signal), csv);
  await assert.rejects(readCatalogCsv(new Blob([new Uint8Array([0xff])]), signal), /CSV_FORMAT/);
  await assert.rejects(readCatalogCsv({ size: csvPreviewByteLimit + 1, stream() { assert.fail("oversized read"); } }, signal), /CSV_LIMIT/);
  for (const [size, data, pattern] of [[1, [1,2], /CSV_LIMIT/], [2,[1],/CSV_FORMAT/]]) {
    await assert.rejects(readCatalogCsv({size, stream: () => new ReadableStream({start(c) {
      c.enqueue(new Uint8Array(data)); c.close();
    }})}, signal), pattern);
  }
});
test("scope abort cancels a pending file stream without preview", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const file = { size: 10, stream: () => new ReadableStream({ cancel() { cancelled = true; } }) };
  const task = readCatalogCsv(file, controller.signal);
  controller.abort();
  await assert.rejects(task, /abort/i);
  assert.equal(cancelled, true);
});

test("owner comparison preserves invalid and local duplicate reasons and does not approve unmatched identities", async () => {
  const rows = previewCatalogCsv(header + " Café ,5,2\nقهوة,10,1\nقهوة,10,2\nماء,0,1\nشاي,50,1");
  const signal = new AbortController().signal;
  const result = await reviewCatalogImportRows(rows, "merchant-a", "store-a", signal, async (store, actor, sig, options) => {
    assert.equal(store, "store-a");
    assert.equal(actor, "merchant-a");
    assert.equal(sig, signal);
    assert.deepEqual(options, {limit:50});
    return {actorId:actor,storeId:store,items:[
      {id:"of-a",storeId:store,name:"CAFE\u0301"},
      {id:"of-b",storeId:store,name:"قهوة"},
      {id:"of-c",storeId:store,name:"ماء"},
    ]};
  });
  assert.deepEqual(result.map(row => row.reason),
    ["existing-store-name","duplicate-name","duplicate-name","invalid","owner-review"]);
  assert.equal(rows[0].reason, "owner-review");
});

test("owner review rejects incomplete, foreign, repeated and aborted pagination without publishing partial matches", async () => {
  const rows = previewCatalogCsv(header + "قهوة,1,1");
  const page = (items, nextCursor) => ({actorId:"merchant-a",storeId:"store-a",items,...(nextCursor ? {nextCursor} : {})});
  const items = Array.from({length:50},(_,i)=>({id:"of-"+String(i).padStart(2,"0"),storeId:"store-a",name:"قهوة"}));
  const first = page(items,"of-49");
  const run = (read, signal=new AbortController().signal) => reviewCatalogImportRows(rows,"merchant-a","store-a",signal,read);
  for (const next of [
    {...page([]),actorId:"other"},
    {...page([]),storeId:"other"},
    page([{id:"of-49",storeId:"store-a",name:"قهوة"}]),
    page([{id:"of-z",storeId:"other",name:"قهوة"}]),
    page([{id:"of-z",storeId:"store-a",name:"قهوة"}],"of-z"),
  ]) await assert.rejects(run(async (_s,_a,_signal,opt)=>opt.cursor ? next : first), /CATALOG_EXPORT_SCOPE/);
  await assert.rejects(run(async (_s,_a,_signal,opt)=>{
    if(opt.cursor) throw new Error("revoked");
    return first;
  }),/revoked/);
  const controller = new AbortController();
  await assert.rejects(run(async ()=>{controller.abort();return first;},controller.signal));
  assert.equal(rows[0].reason,"owner-review");
});

test("conflict detail preserves exact owner price and stock only for a unique matching offer", async () => {
  const rows = previewCatalogCsv(header + "قهوة,100,2\nشاي,200,3\nماء,300,4");
  const offer = (id, name, priceYer, stockUnits, published) => ({id,storeId:"store-a",name,priceYer,stockUnits,published});
  const result = await reviewCatalogImportRows(rows,"merchant-a","store-a",new AbortController().signal,
    async () => ({actorId:"merchant-a",storeId:"store-a",items:[
      offer("of-a","قهوة","9223372036854775807",0,true),
      offer("of-b","شاي","90",10,false),
      offer("of-c","شاي","190",20,true),
    ]}));
  assert.deepEqual(result[0].match,{count:1,priceYer:"9223372036854775807",stockUnits:0,published:true});
  assert.deepEqual(result[1].match,{count:2});
  assert.equal(result[2].match,undefined);
  assert.equal(result[2].reason,"owner-review");
  assert.equal(rows[0].match,undefined);
});

test("only one inactive versioned draft can be selected; duplicate and active identities remain held", async () => {
  const rows = previewCatalogCsv(header + "قهوة,100,2\nشاي,200,3\nماء,300,4\nسكر,400,5\nملح,500,6");
  const offer = (id,name,change={}) => ({
    id, name, storeId:"store-a", productId:"pr-"+id, variantId:"va-"+id,
    priceYer:"20", stockUnits:1, draftVersion:7,
    published:false, available:false, productActive:false, variantSellable:false,
    requiredAttributesValid:false, ...change,
  });
  const selected = offer("of-a","قهوة");
  const result = await reviewCatalogImportRows(rows,"merchant-a","store-a",new AbortController().signal,
    async () => ({actorId:"merchant-a",storeId:"store-a",items:[
      selected, offer("of-b","شاي"), offer("of-c","شاي"),
      offer("of-d","ماء",{published:true}), offer("of-e","سكر",{productActive:true}),
      offer("of-f","ملح",{draftVersion:Number.MAX_SAFE_INTEGER}),
    ]}));
  assert.deepEqual(result[0].editableDraft,selected);
  assert.deepEqual(result.slice(1).map(row=>row.editableDraft),[undefined,undefined,undefined,undefined]);
  assert.equal(result[1].match.count,2);
  assert.equal(rows[0].editableDraft,undefined);
});
