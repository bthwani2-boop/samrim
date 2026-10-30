import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const gate = readFileSync(path.resolve(import.meta.dirname, "../src/features/access/identity-gate.tsx"), "utf8");

test("partner sign-up action respects the bottom system navigation inset", () => {
  assert.match(gate, /SafeAreaView edges=\{\["bottom"\]\}/);
  assert.match(gate, /انضم كمتجر جديد دون ميداني/);
  assert.doesNotMatch(gate, /<View style=\{\{ paddingHorizontal: 16, paddingBottom: 16 \}\}>/);
});
