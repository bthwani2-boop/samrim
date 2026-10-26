import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "../proxy.ts");
const source = readFileSync(path, "utf8");
function hasUnconditionalApiMatcher(input) {
  const start = /matcher:[ \t]*\[/.exec(input);
  if (!start) return false;
  const lines = input.slice(start.index + start[0].length).split(/\r?\n/);
  const firstRule = lines.map((line) => line.trim()).find((line) => line && !line.startsWith("//"));
  return firstRule === '{ source: "/api/:path*" },';
}

test("all API routes stay behind the origin guard even with prefetch headers", () => {
  assert.equal(hasUnconditionalApiMatcher(source), true, "API match must not depend on prefetch headers");
  assert.match(source, /UNSAFE_METHODS\.has\(request\.method\.toUpperCase\(\)\)/, "unsafe API methods must be checked");
  assert.match(source, /!verifySameOrigin\(request\)/, "origin verification must remain active");
});

test("the matcher regression check detects a prefetch exemption", () => {
  const unsafe = source.replace(
    '{ source: "/api/:path*" }',
    '{ source: "/api/:path*", missing: [{ type: "header", key: "purpose", value: "prefetch" }] }',
  );
  assert.notEqual(unsafe, source, "test fixture must actually change the API matcher");
  assert.equal(hasUnconditionalApiMatcher(unsafe), false, "a prefetch-exempt API route must fail the guard");
});
