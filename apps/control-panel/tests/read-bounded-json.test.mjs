import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const { readBoundedJson } = await import("../src/server/security/read-bounded-json.ts");

const url = "http://localhost/studio/secure";
test("studio JSON reader accepts correctly bounded input", async () => {
  const result = await readBoundedJson(new Request(url, {
    method: "PUT", body: JSON.stringify({ value: "بثواني", version: 2 }),
  }), 1024);
  assert.deepEqual(result, { ok: true, value: { value: "بثواني", version: 2 } });
});

test("studio JSON reader rejects malformed and oversized bodies without Content-Length", async () => {
  const malformed = await readBoundedJson(new Request(url, { method: "PUT", body: "{bad" }), 50);
  assert.deepEqual(malformed, { ok: false, status: 400 });
  const largeBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(512).fill(65));
      controller.enqueue(new Uint8Array(512).fill(65));
      controller.close();
    },
  });
  const oversized = await readBoundedJson(new Request(url, {
    method: "PUT", body: largeBody, duplex: "half",
  }), 512);
  assert.deepEqual(oversized, { ok: false, status: 413 });
});

test("studio JSON reader rejects invalid UTF8 and declared oversize", async () => {
  const malformedBytes = new Request(url, {
    method: "PUT", body: new Uint8Array([0x7B, 0x22, 0x78, 0x22, 0x3A, 0xFF, 0x7D]),
  });
  assert.deepEqual(await readBoundedJson(malformedBytes, 512), { ok: false, status: 400 });
  const declared = new Request(url, {
    method: "PUT", body: JSON.stringify({ text: "oversize" }), headers: { "Content-Length": "6000" },
  });
  assert.deepEqual(await readBoundedJson(declared, 512), { ok: false, status: 413 });
});
