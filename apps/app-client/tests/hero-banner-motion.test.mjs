import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { wrapBannerIndex } from "../src/features/store-discovery/banner-loop.ts";

const discovery = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");
const hero = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/looping-hero-banner.tsx"), "utf8");
for (const [name, source] of [["store-discovery.tsx", discovery], ["looping-hero-banner.tsx", hero]]) {
  const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  test(name + " parses without syntax errors", () => assert.equal(syntax.parseDiagnostics.length, 0));
}

test("home uses the independent banner instead of the RTL ScrollView carousel", () => {
  assert.match(discovery, /<LoopingHeroBanner screenActive=\{isScreenActive\} presentation=\{bannerPresentation\} cardWidth=\{carouselCardWidth\} items=\{bannerContent\}/);
  assert.match(discovery, /<StoreDirectoryCard/);
  assert.doesNotMatch(hero, /<Animated\.ScrollView|onContentSizeChange|snapToInterval|physicalIndex/);
  assert.doesNotMatch(hero, /carouselDots|heroProgressTrack|heroPauseIcon/);
  assert.match(hero, /onPress=\{\(\) => openRef\.current\(\)\}/);
});

test("continuous autoplay keeps one stable interval regardless of the active index", () => {
  assert.match(hero, /setInterval\(\(\) => navigateRef\.current\(1\), presentation\.intervalSeconds \* 1000\)/);
  assert.match(hero, /return \(\) => clearInterval\(timer\)/);
  assert.match(hero, /!screenActive \|\| !foreground \|\| interacting \|\| reducedMotion \|\| presentation\.mode === "STATIC"/);
  assert.match(hero, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(hero, /AppState\.addEventListener/);
  assert.match(hero, /Animated\.timing\(animated/);
  assert.match(hero, /useNativeDriver: true/);
});

test("wraps from last to first indefinitely, including more than two banners", () => {
  for (const count of [2, 3, 5]) {
    let current = 0;
    const seen = [];
    for (let tick = 0; tick < count * 4; tick += 1) {
      seen.push(current);
      current = wrapBannerIndex(current, 1, count);
    }
    assert.deepEqual(seen, Array.from({ length: count * 4 }, (_, i) => i % count));
    assert.equal(current, 0);
    assert.equal(wrapBannerIndex(0, -1, count), count - 1);
  }
  assert.equal(wrapBannerIndex(0, 1, 0), 0);
});

test("manual gestures can advance and reverse, while marketing modes remain respected", () => {
  assert.match(hero, /PanResponder\.create/);
  assert.match(hero, /gesture\.dx < 0 \? 1 : -1/);
  assert.match(hero, /presentation\.mode === "CROSSFADE"/);
  assert.match(hero, /presentation\.mode === "STATIC"/);
  assert.match(hero, /recordDiscoveryImpression\(activeItem\.id\)/);
  assert.match(hero, /onOpen\(item\)/);
});

test("marketing settings remain server-authoritative", () => {
  assert.match(discovery, /readPublicBannerPresentation\(\)/);
  assert.match(discovery, /setInterval\(refresh, 60_000\)/);
});
