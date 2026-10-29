import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/marketing/marketing-banner-presentation.tsx"), "utf8");

test("operator preview shows the full 1:1 home stage with the artwork confined to the lower region", () => {
  assert.match(source, /aspectRatio: "1 \/ 1"/);
  assert.match(source, /height: "57\.14%"/);
  assert.match(source, /objectFit: "cover"/);
  assert.match(source, /البنر المربعة 1:1/);
  assert.doesNotMatch(source, /aspectRatio: "1\.75"/);
});
