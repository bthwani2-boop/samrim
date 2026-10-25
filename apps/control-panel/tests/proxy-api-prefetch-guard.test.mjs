import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "../proxy.ts");
const source = readFileSync(path, "utf8");
const unconditionalApiMatcher = /matcher:\s*\[\s*(?:\/\/[^\n]*\r?\n\s*)*\{\s*source:\s*["']\/api\/:path\*["']\s*\}/;

test("all API routes stay behind the origin guard even with prefetch headers", () => {
  assert.match(source, unconditionalApiMatcher, "API match must not depend on prefetch headers");
  assert.match(source, /UNSAFE_METHODS\.has\(request\.method\.toUpperCase\(\)\)/, "unsafe API methods must be checked");
  assert.match(source, /!verifySameOrigin\(request\)/, "origin verification must remain active");
});

test("the matcher regression check detects a prefetch exemption", () => {
  const unsafe = source.replace(
    '{ source: "/api/:path*" }',
    '{ source: "/api/:path*", missing: [{ type: "header", key: "purpose", value: "prefetch" }] }',
  );
  assert.notEqual(unsafe, source, "test fixture must actually change the API matcher");
  assert.doesNotMatch(unsafe, unconditionalApiMatcher, "a prefetch-exempt API route must fail the guard");
});
