import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-detail.tsx"), "utf8");

test("each Native Store catalog row mounts its own pan gesture without web gesture handlers", () => {
  // React Native GestureDetector cannot share one gesture instance across
  // multiple simultaneously visible FlatList rows. The original single
  // tabSwipeGesture appeared in every offer/empty row.
  assert.doesNotMatch(source, /const tabSwipeGesture = Gesture\.Pan\(\)/);
  assert.match(source, /const withNativeTabSwipe = \(content: ReactNode\) => \{/);
  assert.match(source, /if \(Platform\.OS === "web"\) return content;/);
  assert.match(source, /const rowSwipeGesture = Gesture\.Pan\(\)/);
  assert.match(source, /<GestureDetector gesture=\{rowSwipeGesture\}>\{content\}<\/GestureDetector>/);
  assert.match(source, /\.failOffsetY\(\[-18, 18\]\)/);
  assert.match(source, /runOnJS\(switchCatalogTabOnSwipe\)\(event\.translationX\)/);
});
