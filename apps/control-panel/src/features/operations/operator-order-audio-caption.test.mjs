import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(
  readFileSync(new URL("./operator-order-audio-caption.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports = {};
runInNewContext(compiled, { exports });
const { audioMessageTranscript, audioMessageCaptionUrl } = exports;

test("legacy audio labels do not masquerade as real captions", () => {
  for (const label of ["", "  رسالة صوتية  ", "تسجيل صوتي", "voice message"]) {
    assert.equal(audioMessageTranscript(label), null);
    assert.equal(audioMessageCaptionUrl(label), null);
  }
});

test("author-provided audio transcript becomes private valid VTT cues", () => {
  const url = audioMessageCaptionUrl("  مرحبا\nكيف الحال؟  ");
  assert.ok(url.startsWith("data:text/vtt;charset=utf-8,"));
  const vtt = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 01:00:00\.000\n/);
  assert.ok(vtt.includes("مرحبا كيف الحال؟"));
});

test("caption content cannot inject VTT markup or cue timing", () => {
  const url = audioMessageCaptionUrl("<script>\n00:00:12.000 --> 00:00:19.000 & مرحبا");
  const vtt = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  assert.equal(vtt.match(/--> /gu)?.length, 1);
  assert.ok(vtt.includes("&lt;script&gt;"));
  assert.ok(vtt.includes("&amp;"));
});
