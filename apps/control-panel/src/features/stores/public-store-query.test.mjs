import assert from "node:assert/strict";
import test from "node:test";
import { isolatedPublicDshOrigin, parsePublicStoreBrowse, publicStorePageHref, resolvePublicDshOrigin } from "./public-store-query.ts";

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
});

test("invalid search scopes and duplicate parameters fail before any owner read", () => {
  for (const params of [
    { city: "Sanaa" }, { city: "../a" }, { city: ["sanaa", "aden"] },
    { city: "sanaa", vertical: "GROCERY" }, { city: "sanaa", vertical: "" },
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
