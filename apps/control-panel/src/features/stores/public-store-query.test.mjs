import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isolatedPublicDshOrigin, parsePublicStoreBrowse, publicStorePageHref, resolvePublicDshOrigin } from "./public-store-query.ts";

test("Operator ID fields enforce the owner format with the browser's Unicode Sets syntax", () => {
  for (const route of [
    "../workspace/public-market-overview.tsx",
    "../catalog/published-offers.tsx",
    "../../../app/(workspace)/catalog/categories/page.tsx",
    "../../../app/(workspace)/merchants/joining/page.tsx",
    "../../../app/(workspace)/merchants/public-stores/page.tsx",
    "../../../app/(workspace)/operations/store-availability/page.tsx",
  ]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    const patterns = Array.from(source.matchAll(/pattern="([^"]+)"/g), match => match[1]);
    assert.ok(patterns.length, route);
    for (const pattern of patterns) {
      const rule = new RegExp(`^(?:${pattern})$`, "v");
      for (const id of ["sanaa", "store-001", "a".repeat(64)]) assert.ok(rule.test(id), route);
      for (const id of ["", "Sanaa", "store/1", "store 1", "a".repeat(65)]) assert.ok(!rule.test(id), route);
    }
  }
});

test("operator public Store query accepts bounded city/search and preserves safe paging", () => {
  assert.deepEqual(parsePublicStoreBrowse({ city: "sanaa", q: "  مخبز  ", cursor: "Ab_12" }), {
    city: "sanaa", query: "مخبز", cursor: "Ab_12",
  });
  assert.equal(publicStorePageHref({ city: "sanaa", query: "متجر", cursor: "a_b" }),
    "/merchants/public-stores?city=sanaa&q=%D9%85%D8%AA%D8%AC%D8%B1&cursor=a_b");
  assert.deepEqual(parsePublicStoreBrowse({ city: undefined }), { city: "", query: "" });
});

test("Operator Store vertical stays scoped across search, detail and paging URLs", () => {
  const scope = parsePublicStoreBrowse({ city: "sanaa", q: "market", vertical: "grocery", cursor: "next" });
  assert.deepEqual(scope, { city: "sanaa", query: "market", vertical: "grocery", cursor: "next" });
  assert.equal(publicStorePageHref(scope),
    "/merchants/public-stores?city=sanaa&q=market&vertical=grocery&cursor=next");
  assert.deepEqual(parsePublicStoreBrowse({ city: "sanaa", vertical: "grocery" }), {
    city: "sanaa", query: "", vertical: "grocery",
  });
  assert.deepEqual(parsePublicStoreBrowse({ city: "sanaa", q: "", vertical: "" }), {
    city: "sanaa", query: "",
  });
});

test("invalid search scopes and duplicate parameters fail before any owner read", () => {
  for (const params of [
    { city: "Sanaa" }, { city: "../a" }, { city: ["sanaa", "aden"] },
    { city: "sanaa", vertical: "GROCERY" }, { city: "sanaa", vertical: " " },
    { city: "sanaa", vertical: ["", "grocery"] },
    { city: "sanaa", vertical: "../private" }, { city: "sanaa", vertical: ["grocery", "pharmacy"] },
    { city: "sanaa", q: ["a", "b"] }, { city: "sanaa", q: "x".repeat(81) },
    { city: "sanaa", q: "\uD800" }, { city: "sanaa", cursor: "x".repeat(513) },
    { city: "sanaa", cursor: "invalid/" }, { city: "sanaa", extra: "data" },
    { city: "", cursor: "some-cursor" },
  ]) {
    assert.equal(parsePublicStoreBrowse(params), null, JSON.stringify(params));
  }
});

test("DSH public-read origin is restricted to an explicitly configured local host", () => {
  assert.equal(isolatedPublicDshOrigin("http://127.0.0.1:3202"), "http://127.0.0.1:3202");
  assert.equal(isolatedPublicDshOrigin("http://localhost:3202"), "http://localhost:3202");
  for (const value of [undefined, "http://evil.example:3202", "https://127.0.0.1:3202",
    "http://127.0.0.1:3202/sub", "http://user@127.0.0.1:3202", "http://127.0.0.1:3202?x=1"]) {
    assert.equal(isolatedPublicDshOrigin(value), null);
  }
});

test("only development may use the fixed isolated DSH loopback fallback", () => {
  assert.equal(resolvePublicDshOrigin(undefined, "development"), "http://127.0.0.1:3202");
  assert.equal(resolvePublicDshOrigin(undefined, "production"), null);
  assert.equal(resolvePublicDshOrigin("http://evil.example:3202", "development"), null);
  assert.equal(resolvePublicDshOrigin("http://127.0.0.1:3202", "production"), "http://127.0.0.1:3202");
});

test("public directory and catalog preserve the DSH Unicode search scope and reject non-own parameters", async () => {
  const { parsePublishedOfferQuery } = await import("./public-store-query.ts");
  for (const q of ["\uFEFFmarket", "market\uFEFF", "\u2003market\u2003", "\u0085market\u0085"]) {
    const expected = q.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
    assert.equal(parsePublicStoreBrowse({ city: "sanaa", q })?.query, expected);
    assert.equal(parsePublishedOfferQuery({ store: "market-sanaa", q })?.query, expected);
  }
  assert.equal(parsePublicStoreBrowse(Object.create({city:"sanaa"})),null);
  assert.equal(parsePublishedOfferQuery(Object.create({store:"market-sanaa"})),null);
});

test("one query boundary handles malformed inputs, invalid code points and owner origin rejection", async () => {
  const { parsePublishedOfferQuery, parsePublicStoreDetail } = await import("./public-store-query.ts");
  for (const params of [null, [], 1, Object.create({q:"test"})]) {
    assert.equal(parsePublicStoreBrowse(params),null);
    assert.equal(parsePublishedOfferQuery(params),null);
    assert.equal(parsePublicStoreDetail("store-a",params),null);
  }
  for (const q of ["\u007f","\udfff","\u0001","x".repeat(81)]) {
    assert.equal(parsePublicStoreBrowse({city:"sanaa",q}),null);
    assert.equal(parsePublishedOfferQuery({store:"store-a",q}),null);
  }
  assert.equal(parsePublicStoreDetail(["store-a"],{city:"sanaa"}),null);
  assert.equal(isolatedPublicDshOrigin("http://127.0.0.1:99999"),null);
});
