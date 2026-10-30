import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feature = path.resolve(import.meta.dirname, "../src/features/store-discovery");
const discovery = readFileSync(path.join(feature, "store-discovery.tsx"), "utf8");
const banner = readFileSync(path.join(feature, "looping-hero-banner.tsx"), "utf8");
const home = readFileSync(path.resolve(import.meta.dirname, "../app/(app)/home.tsx"), "utf8");
const shell = readFileSync(path.resolve(import.meta.dirname, "../src/shell/client-shell.tsx"), "utf8");

test("home search and branding overlay the moving hero rather than a separate static header", () => {
  assert.match(home, /heroHeader=\{!searchOpen \?/);
  assert.match(home, /homeTransparent/);
  assert.match(discovery, /immersiveHeader=\{heroHeader\}/);
  assert.match(banner, /immersiveHeader \? <View/);
  assert.match(shell, /homeTransparent && \{ backgroundColor: "transparent" \}/);
});

test("delivery messaging is a fixed sibling below the animated banner, not a fabricated countdown", () => {
  const bannerAt = discovery.indexOf("immersiveHeader={heroHeader}");
  const stripAt = discovery.indexOf('accessibilityLabel="معلومات التوصيل والعروض"');
  assert.ok(bannerAt >= 0 && stripAt > bannerAt);
  const strip = discovery.slice(stripAt, stripAt + 500);
  assert.match(strip, /الرسوم والعروض المتاحة قبل تأكيد الطلب/);
  assert.doesNotMatch(strip, /75 دقيقة|توصيل مجاني|countdown/i);
});

test("one slide palette spans the full header and media stage without an independently colored header", () => {
  assert.match(banner, /function immersiveSlidePalette\(item: PublicDiscoveryContentView\)/);
  assert.match(banner, /const colors = immersiveSlidePalette\(item\)/);
  assert.match(banner, /const height = immersive \? cardWidth : Math\.round\(cardWidth \/ 1\.75\)/);
  assert.match(banner, /const mediaHeight = immersive \? Math\.round\(cardWidth \/ 1\.75\) : height/);
  assert.match(banner, /locations=\{\[0, \(height - mediaHeight\) \/ height, 1\]\}/);
  assert.match(banner, /start=\{\{ x: 0\.5, y: 0 \}\} end=\{\{ x: 0\.5, y: 1 \}\}/);
  assert.match(banner, /colors=\{\[colors\[1\], colors\[1\] \+ "00"\]\}/);
  assert.doesNotMatch(banner, /items\.findIndex\(\(value\) => value\.id === item\.id\)/);
  assert.match(home, /homeTransparent/);
});

test("hero movement uses published media and honors offscreen/foreground/motion settings", () => {
  assert.match(banner, /ExpoImage/);
  assert.match(banner, /Gesture\.Pan\(\)/);
  assert.match(banner, /Animated\.timing\(animated/);
  assert.match(banner, /useNativeDriver: true/);
  assert.match(banner, /!screenActive \|\| !foreground \|\| interacting \|\| reducedMotion/);
});

test("home search remains available in the immersive and compact headers without an obstructing floating control", () => {
  assert.match(home, /<ClientPublicHeader/);
  assert.match(home, /homeCompact=\{compactHeader\}/);
  assert.match(home, /onSearchOpenChange=\{setSearchVisibility\}/);
  assert.match(shell, /<BthwaniSearchField/);
  assert.doesNotMatch(home, /quickSearch|بحث سريع عن المنتجات|orbScale/);
});

test("published banner artwork is fully contained in its stage instead of cropping promotional text", () => {
  assert.match(banner, /contentFit="contain"/);
});
