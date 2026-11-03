import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/store-discovery/store-discovery.tsx", import.meta.url), "utf8");
const start = source.indexOf("function StoreDirectoryStatus(");
const end = source.indexOf("function DiscoveryMediaCarousel(", start);
const component = start >= 0 && end > start ? source.slice(start, end) : "";

test("empty store directory gives selected-category feedback before the city-wide empty message", () => {
  assert.ok(component.length > 0, "store directory status component must exist");
  const categoryBranch = component.indexOf("} else if (selectedCategory) {");
  const cityBranch = component.indexOf('} else if (kind === "empty") {');
  assert.ok(categoryBranch >= 0 && cityBranch > categoryBranch, "selected category must take precedence over general empty state");
  assert.match(component, /لا توجد متاجر ضمن هذه الفئة/);
});

test("filtered empty directory offers a direct, scoped recovery action", () => {
  assert.ok(source.includes('onClearCategory={() => selectCategory("")}'), "clear category must be wired to the existing taxonomy action");
  assert.match(component, /selectedCategory \? <BthwaniButton label="مسح الفئة" onPress=\{onClearCategory\}/);
  assert.match(component, /query\.trim\(\) \? <BthwaniButton label="مسح البحث" onPress=\{onClearSearch\}/);
});

test("loading, failure and retry remain separate from the category-empty state", () => {
  assert.match(component, /kind === "loading"/);
  assert.match(component, /kind === "error"[\s\S]*?label="إعادة المحاولة" onPress=\{onRetry\}/);
  assert.match(component, /onClearCategory: \(\) => void/);
});
