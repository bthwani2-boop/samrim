import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");

test("changing partner status in the Ant Design toolbar retains selected city", () => {
  const statusControl = source.match(/<Select id="partner-unified-status"[\s\S]*?\/>/)?.[0];

  assert.ok(statusControl, "toolbar status filter remains an Ant Design Select");
  assert.match(statusControl, /onChange=\{\(next: string\) => navigate\(activeTab, kind, next, city, sort, appliedSearch\)\}/);
  assert.doesNotMatch(statusControl, /event\.target\.value/);
});

test("changing partner status in the table column filter retains selected city", () => {
  const statusColumn = source.match(/<RegistryColumnHeader label="[^"]*" active=\{Boolean\(status\)\}>[\s\S]*?<\/RegistryColumnHeader>/)?.[0];

  assert.ok(statusColumn, "table status column filter remains available");
  assert.match(statusColumn, /<select value=\{status\} onChange=\{\(event\) => navigate\(activeTab, kind, event\.target\.value, city, sort, appliedSearch\)\}/);
});

test("switching record kind still intentionally clears incompatible city and status filters", () => {
  const kindControl = source.match(/<Select id="partner-unified-kind"[\s\S]*?\/>/)?.[0];

  assert.ok(kindControl, "toolbar kind filter remains an Ant Design Select");
  assert.match(kindControl, /onChange=\{\(value: Kind\) => navigate\(activeTab, value, "", "", sort, appliedSearch\)\}/);
  assert.match(source, /navigate\(activeTab, event\.target\.value as Kind, "", "", sort, appliedSearch\)/);
  assert.doesNotMatch(source, /navigate\(activeTab, (?:value|event\.target\.value), status, city, sort, appliedSearch\)/);
});
