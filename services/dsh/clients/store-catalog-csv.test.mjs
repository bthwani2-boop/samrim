import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreCatalogCsv, collectStoreCatalogCsv, STORE_CATALOG_EXPORT_PAGE_SIZE, STORE_CATALOG_EXPORT_MAX_ROWS } from "./store-catalog-csv.ts";

const offer = (n, storeId = "store-a") => ({
  storeId, offerId: "offer-" + n, productName: "منتج " + n,
  variantTitle: "الافتراضي", brand: "علامة", priceMinor: 150,
  availability: true, publicationState: "published",
  measurementKind: "DISCRETE", baseUnit: "COUNT",
});

test("every DSH cursor page is exported, including rows beyond the old 2000-row cap", async () => {
  const all = Array.from({length: 2001}, (_, i) => offer(i));
  let calls = 0;
  const result = await collectStoreCatalogCsv("store-a", async cursor => {
    calls++;
    const start = cursor ? Number(cursor) : 0;
    const offers = all.slice(start, start + STORE_CATALOG_EXPORT_PAGE_SIZE);
    const nextCursor = start + offers.length < all.length ? String(start + offers.length) : "";
    return { offers, nextCursor };
  });
  assert.equal(result.count, 2001);
  assert.equal(calls, 41);
  assert.equal(result.csv[0], "\uFEFF");
  assert.equal(result.csv.split("\r\n").length, 2002);
  assert.match(result.csv, /منتج 2000/);
});

test("CSV preserves Arabic, embedded quotes, and prevents spreadsheet formula injection", () => {
  const csv = buildStoreCatalogCsv([{
    ...offer(1),
    productName: '=SUM(1,2)\n"المتجر"',
    brand: "\u200B+HYPERLINK(\"bad\")",
    variantTitle: "-1",
  }]);
  assert.ok(csv.includes(`"'=SUM(1,2) ""المتجر"""`));
  assert.match(csv, /"'\u200B\+HYPERLINK/);
  assert.match(csv, /"'-1"/);
  assert.match(csv, /"150"/);
});

test("mixed Store, duplicate Offer and repeated cursor fail closed", async () => {
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => ({ offers:[offer(1,"store-b")], nextCursor:"" })), /STORE_EXPORT_SCOPE_OR_DUPLICATE/);
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => ({ offers:[offer(1),offer(1)], nextCursor:"" })), /STORE_EXPORT_SCOPE_OR_DUPLICATE/);
  await assert.rejects(collectStoreCatalogCsv("store-a", async cursor => ({ offers:[offer(cursor ? 2 : 1)], nextCursor:"repeat" })), /STORE_EXPORT_CURSOR_REPEATED/);
});

test("empty page with next cursor, malformed page and interrupted read must never create a partial export", async () => {
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => ({offers:[],nextCursor:"more"})), /STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT/);
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => ({offers:null,nextCursor:""})), /STORE_EXPORT_INVALID_RESPONSE/);
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => {throw new Error("network failure");}), /network failure/);
});

test("safety limit refuses an incomplete export instead of silently dropping remaining records", async () => {
  let next = 0;
  await assert.rejects(collectStoreCatalogCsv("store-a", async () => {
    const start = next;
    next += STORE_CATALOG_EXPORT_PAGE_SIZE;
    return {
      offers: Array.from({length: STORE_CATALOG_EXPORT_PAGE_SIZE}, (_,i)=>offer(start+i)),
      nextCursor: String(next),
    };
  }), /STORE_EXPORT_TOO_LARGE_OR_INCONSISTENT/);
  assert.ok(next >= STORE_CATALOG_EXPORT_MAX_ROWS);
});
