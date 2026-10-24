import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../src/features/store-discovery/store-discovery.tsx");
const viewer = read("../src/features/store-discovery/discovery-reels-viewer.tsx");

test("the home page exposes exactly one fixed reels button next to All", () => {
  assert.equal(home.split('accessibilityLabel="ريلز"').length - 1, 1);
  const start = home.indexOf("style={styles.storeFilterRow}");
  const button = home.indexOf("styles.reelsFilterButton", start);
  const filters = home.indexOf("style={styles.storeFilterScroll}", start);
  const all = home.indexOf('selected={storeFilter === "all"}', filters);
  assert.ok(start > 0 && button > start && filters > button && all > filters);
  assert.ok(home.includes('label="الكل"'));
  assert.ok(home.includes('style={styles.storeFilterScroll} horizontal'));
  assert.ok(!home.includes("<HomeReelsEntry"));
  assert.ok(!home.includes('title="شاهد واطلب"'));
  assert.ok(!home.includes("shortFormCard"));
  assert.ok(!home.includes("items={shortFormContent}"));
});

test("reels button remains mounted and does not move with horizontal filters", () => {
  assert.ok(home.includes('disabled={videoShorts.length === 0}'));
  assert.ok(home.includes('onPress={() => { setReelResume(null); setSelectedReelIndex(0); }}'));
  assert.ok(home.includes('storeFilterScroll: { flex: 1, minWidth: 0 }'));
  assert.ok(home.includes('storeFilterRow: { flexDirection: "row"'));
  assert.ok(home.includes('reelsFilterButton:'));
  assert.ok(!home.includes("useVideoPlayer"));
  assert.ok(!home.includes("<HomeReelsEntry"));
});

test("full screen viewer supports up/down swipes for all reels", () => {
  assert.ok(viewer.includes("<FlatList"));
  assert.ok(viewer.includes("data={items}"));
  assert.ok(viewer.includes("pagingEnabled"));
  assert.ok(!viewer.includes("horizontal={true}"));
  assert.ok(viewer.includes("onMomentumScrollEnd"));
  assert.ok(viewer.includes("onIndexChange(next)"));
  assert.ok(viewer.includes("initialScrollIndex={safeIndex}"));
});

test("only one reel plays and navigation can restore position", () => {
  assert.ok(viewer.includes("active={foreground && index === position}"));
  assert.ok(viewer.includes("if (!active) { player.pause(); return; }"));
  assert.ok(viewer.includes("onOpen(item, player.currentTime)"));
  assert.ok(viewer.includes("resume?.id === item.id ? resume.seconds : 0"));
  assert.ok(!viewer.includes("StoreProductSheet"));
});
