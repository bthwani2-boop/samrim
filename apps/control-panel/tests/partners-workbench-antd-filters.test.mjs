import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("workbench toolbar uses labeled Ant Design controls on all tabs and keeps Enter submit", () => {
  assert.match(source, /<Input\.Search id="partner-unified-search" aria-label=\{activeTab === "directory"[\s\S]*?onSearch=\{\(value\) => navigate\(activeTab, kind, status, city, sort, value\.trim\(\)\.slice\(0, 100\)\)\}/);
  assert.match(source, /<Select id="partner-unified-kind"/);
  assert.match(source, /<Select id="partner-unified-status"/);
  assert.match(source, /<Select id="partner-unified-sort"/);
  assert.match(source, /<Select id="partner-unified-city"/);
  assert.match(source, /navigate\(activeTab, kind, next, city, sort, appliedSearch\)/);
  assert.match(source, /navigate\("directory", "store", status, value, sort, appliedSearch\)/);
  assert.match(source, /onSubmit=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.doesNotMatch(source, /onSubmit=\{[^\n]*navigate\(/);
  assert.match(source, /requestedTab === "joining"[\s\S]*requestedTab === "access"/);
});

test("status, city, and submitted search serialize together as browse query state", () => {
  const query = new URLSearchParams();
  const tab = "directory";
  const kind = "store";
  const status = "published";
  const city = "city-42";
  const search = "market name";
  if (tab !== "directory") query.set("tab", tab);
  if (kind !== "store") query.set("kind", kind);
  if (status) query.set("status", status);
  if (city) query.set("serviceCityId", city);
  if (search) query.set("q", search);
  assert.equal(query.toString(), "status=published&serviceCityId=city-42&q=market+name");
  assert.equal(source.includes('if (nextStatus) url.set("status", nextStatus)'), true);
  assert.equal(source.includes('if (nextCity) url.set("serviceCityId", nextCity)'), true);
  assert.equal(source.includes('if (nextQuery && !isPhone(nextQuery)) url.set("q", nextQuery)'), true);
});

test("desktop toolbar retains one search, hides duplicate filters and sizes Ant Design fields", () => {
  assert.match(styles, /\.partner-unified-toolbar > \.field-label:not\(:first-child\)/);
  assert.match(styles, /\.partner-unified-toolbar > \.field-label:first-child/);
  assert.match(styles, /\.partner-unified-toolbar > \.field-label :is\(\.ant-select,\.ant-input-search\)/);
  assert.doesNotMatch(styles, /\.partner-unified-toolbar > label\.field-label/);
});
