import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectEncoding } from "./check-encoding.mjs";

test("accepts proper Arabic and multilingual UTF-8 without rewriting", () => {
  const source = 'المحفظة — نقدًا · Café · Øresund · "hello"';
  assert.deepEqual(inspectEncoding(Buffer.from(source, "utf8")), []);
});

test("detects Arabic UTF-8 decoded as Latin-1", () => {
  const damaged = Buffer.from("المحفظة", "utf8").toString("latin1");
  assert.match(inspectEncoding(Buffer.from(damaged, "utf8")).join(" "), /mojibake/);
});

test("detects Arabic UTF-8 decoded as Windows-1252", () => {
  const damaged = new TextDecoder("windows-1252").decode(Buffer.from("المحفظة"));
  assert.match(inspectEncoding(Buffer.from(damaged, "utf8")).join(" "), /mojibake/);
});

test("rejects replacement glyphs, invalid bytes and BOM", () => {
  assert.match(inspectEncoding(Buffer.from([0xc3, 0x28])).join(" "), /invalid UTF-8/);
  assert.match(inspectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).join(" "), /BOM/);
  assert.match(inspectEncoding(Buffer.from("a\uFFFDb")).join(" "), /U\+FFFD/);
});

test("detects Latin text incorrectly decoded from UTF-8", () => {
  const damaged = new TextDecoder("windows-1252").decode(Buffer.from("Crème brûlée"));
  assert.match(inspectEncoding(Buffer.from(damaged, "utf8")).join(" "), /mojibake/);
});

test("detects Cyrillic and CJK text incorrectly decoded as Latin-1", () => {
  for (const original of ["Привет", "中文", "한글"]) {
    const damaged = Buffer.from(original, "utf8").toString("latin1");
    assert.match(inspectEncoding(Buffer.from(damaged, "utf8")).join(" "), /mojibake/);
  }
});
