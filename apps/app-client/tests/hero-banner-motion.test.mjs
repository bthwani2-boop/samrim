import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");
const syntax = ts.createSourceFile("store-discovery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("discovery keeps store filters while removing the redundant heading and count", () => {
  assert.equal(syntax.parseDiagnostics.length, 0);
  assert.doesNotMatch(source, /title=\{searchIsActive \? "نتائج المتاجر" : "المتاجر المتاحة"/);
  assert.doesNotMatch(source, /\$\{filteredStores\.length\} متجر معروض/);
  assert.match(source, /accessibilityLabel="تصفية المتاجر والفئات"/);
  assert.match(source, /<StoreDirectoryCard/);
});

test("main marketing banner is full image while secondary carousels retain captions", () => {
  assert.match(source, /<DiscoveryMediaCarousel hero cardWidth=\{carouselCardWidth\} items=\{bannerContent\}/);
  assert.match(source, /hero && \{ height: Math\.round\(cardWidth \/ 2\.5\) \}/);
  assert.match(source, /!hero \? <View pointerEvents="none" style=\{styles\.mediaCaption\}/);
  assert.match(source, /source=\{\{ uri: item\.mediaUri \}\}/);
  assert.match(source, /onPress=\{\(\) => onOpen\(item\)\}/);
});

test("main hero supports infinite manual swipe, native progress and motion safety", () => {
  assert.match(source, /const loop = hero && items\.length > 1;/);
  assert.match(source, /\[items\[items\.length - 1\]!, \.\.\.items, items\[0\]!\]/);
  assert.match(source, /onMomentumScrollEnd=\{\(event\) => \{ settle/);
  assert.match(source, /onScrollBeginDrag=\{\(\) => setInteracting\(true\)\}/);
  assert.match(source, /onPress=\{\(\) => choose\(index\)\}/);
  assert.match(source, /duration: 5000, easing: Easing\.linear, useNativeDriver: true/);
  assert.match(source, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(source, /AppState\.addEventListener/);
  assert.match(source, /!focused \|\| !foreground \|\| reducedMotion \|\| interacting \|\| paused/);
  assert.match(source, /إيقاف الحركة التلقائية/);
});
