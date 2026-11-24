import assert from "node:assert/strict";
import { test } from "node:test";
import { csvPreviewByteLimit, previewCatalogCsv, readCatalogCsv } from "./catalog-import-data.ts";

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
