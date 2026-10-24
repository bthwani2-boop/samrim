import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../src/features/store-discovery/store-discovery.tsx");
const card = read("../src/features/store-discovery/home-reels-entry.tsx");
const viewer = read("../src/features/store-discovery/discovery-reels-viewer.tsx");

test("one home block opens the complete video feed", () => {
  assert.equal(home.split("<HomeReelsEntry").length - 1, 1);
  assert.ok(home.includes("first={videoShorts[0]!}"));
  assert.ok(home.includes("count={videoShorts.length}"));
  assert.ok(!home.includes("shortFormCard"));
  assert.ok(!home.includes("items={shortFormContent}"));
  assert.ok(!home.includes("openShort("));
  assert.ok(home.includes("setReelResume(null); setSelectedReelIndex(0)"));
});

test("the home cover is cached as an image and never auto plays", () => {
  assert.ok(card.includes("first.posterUri"));
  assert.ok(card.includes('cachePolicy="memory-disk"'));
  assert.ok(card.includes("recordDiscoveryImpression(first.id)"));
  assert.ok(!card.includes("VideoView"));
  assert.ok(!card.includes("useVideoPlayer"));
  assert.ok(card.includes('accessibilityRole="button"'));
});

test("the viewer pages vertically through all videos", () => {
  assert.ok(viewer.includes("<FlatList"));
  assert.ok(viewer.includes("data={items}"));
  assert.ok(viewer.includes("pagingEnabled"));
  assert.ok(!viewer.includes("horizontal={true}"));
  assert.ok(viewer.includes("onMomentumScrollEnd"));
  assert.ok(viewer.includes("setIndex(next)"));
  assert.ok(viewer.includes("onIndexChange(next)"));
  assert.ok(viewer.includes("initialScrollIndex={safeIndex}"));
});

test("only one video plays and original destinations retain the playhead", () => {
  assert.ok(viewer.includes("active={foreground && index === position}"));
  assert.ok(viewer.includes("if (!active) { player.pause(); return; }"));
  assert.ok(viewer.includes("onOpen(item, player.currentTime)"));
  assert.ok(viewer.includes("resume?.id === item.id ? resume.seconds : 0"));
  assert.ok(!viewer.includes("StoreProductSheet"));
  assert.ok(!viewer.includes("addCatalogOfferToCart"));
});
