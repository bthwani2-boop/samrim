import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");

test("changing partner status in toolbar retains selected city", () => {
  assert.match(source, /const next = event\.target\.value;\s*navigate\(activeTab, kind, next, city, sort, appliedSearch\)/);
});

test("changing partner status in column filter retains selected city", () => {
  assert.match(source, /label>حالة السجل<select[^>]*onChange=\{\(event\) => navigate\(activeTab, kind, event\.target\.value, city, sort, appliedSearch\)\}/);
});

test("switching record kind still intentionally clears incompatible city and status filters", () => {
  assert.match(source, /navigate\(activeTab, event\.target\.value as Kind, "", "", sort, appliedSearch\)/);
  assert.doesNotMatch(source, /navigate\(activeTab, kind, (?:next|event\.target\.value), "", sort, appliedSearch\)/);
});
