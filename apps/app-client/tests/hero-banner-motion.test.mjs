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
  assert.match(source, /<DiscoveryMediaCarousel hero screenActive=\{isScreenActive\} presentation=\{bannerPresentation\} cardWidth=\{carouselCardWidth\} items=\{bannerContent\}/);
  assert.match(source, /hero && \{ height: Math\.round\(cardWidth \/ 1\.75\) \}/);
  assert.match(source, /!hero \? <View pointerEvents="none" style=\{styles\.mediaCaption\}/);
  assert.match(source, /source=\{\{ uri: item\.mediaUri \}\}/);
  assert.match(source, /onPress=\{\(\) => onOpen\(item\)\}/);
});

test("main hero uses independent autoplay, manual swipe and reduced-motion safety without noisy controls", () => {
  assert.match(source, /const loop = hero && items\.length > 1;/);
  assert.match(source, /\[items\[items\.length - 1\]!, \.\.\.items, items\[0\]!\]/);
  assert.match(source, /onMomentumScrollEnd=\{\(event\) => \{ settle/);
  assert.match(source, /onScrollBeginDrag=\{\(\) => setInteracting\(true\)\}/);
  assert.match(source, /const timer = setTimeout\(\(\) => choose\(\(activeIndex \+ 1\) % items\.length\), presentation\.intervalSeconds \* 1000\);/);
  assert.match(source, /return \(\) => clearTimeout\(timer\);/);
  assert.match(source, /!hero && items\.length > 1 \? <View/);
  assert.doesNotMatch(source, /heroProgressTrack|heroPauseIcon|Animated\.timing\(progress/);
  assert.match(source, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(source, /AppState\.addEventListener/);
  assert.match(source, /!foreground \|\| reducedMotion \|\| interacting \|\| presentation\.mode === "STATIC"/);
});

test("marketing controls the banner and route focus stops autoplay", () => {
  assert.match(source, /readPublicBannerPresentation\(\)/);
  assert.match(source, /setInterval\(refresh, 60_000\)/);
  assert.match(source, /!hero \|\| !screenActive \|\| !foreground/);
  assert.match(source, /presentation\.mode === "STATIC"/);
  assert.match(source, /presentation\.intervalSeconds \* 1000/);
});

test("crossfade uses a native opacity transition and leaves manual swiping enabled", () => {
  assert.match(source, /presentation\.mode === "CROSSFADE"/);
  assert.match(source, /Animated\.timing\(fadeOpacity, \{ toValue: 0, duration: 550, useNativeDriver: true \}\)/);
  assert.match(source, /pointerEvents="none"/);
  assert.match(source, /onScrollBeginDrag=\{\(\) => setInteracting\(true\)\}/);
});
