import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Test-only loader for TypeScript-emitted CommonJS render fixtures. Preserve
// the compiler's mappings and validate the original source before execution.
export function loadMappedRenderFixture(compiled, source, mocks) {
  const marker = "//# sourceMappingURL=data:application/json;base64,";
  const mapOffset = compiled.lastIndexOf(marker);
  assert.ok(mapOffset >= 0, "compiler must emit an inline source map");
  const payloadOffset = mapOffset + marker.length;
  const map = JSON.parse(Buffer.from(compiled.slice(payloadOffset).trim(), "base64").toString("utf8"));
  assert.ok(map.version === 3 && map.sources?.length === 1 &&
    path.basename(map.sources[0].replaceAll("\\", "/")) === path.basename(source), "incorrect source identity");
  assert.equal(map.sourcesContent?.[0], readFileSync(source, "utf8"), "compiled fixture must match current source");
  map.sourceRoot = "";
  map.sources = [pathToFileURL(source).href];
  // V8 reports raw script URLs, while Node encodes bracketed Expo route names.
  // Use a stable virtual generated name without URL-sensitive characters.
  // Next dynamic directories also contain brackets. Place only those virtual
  // scripts beside this loader, with a full-source-path digest to avoid collisions.
  const directory = path.dirname(source);
  const filename = /[[\]]/.test(directory)
    ? path.join(path.dirname(fileURLToPath(import.meta.url)), createHash("sha256").update(path.resolve(source)).digest("hex") + ".compiled.cjs")
    : path.join(directory, Buffer.from(path.basename(source)).toString("hex") + ".compiled.cjs");
  const module = new Module(filename);
  module.filename = filename;
  module.require = name => {
    assert.ok(Object.hasOwn(mocks, name), "unexpected fixture dependency: " + name);
    return mocks[name];
  };
  module._compile(compiled.slice(0, payloadOffset) + Buffer.from(JSON.stringify(map)).toString("base64"), filename);
  return module;
}
