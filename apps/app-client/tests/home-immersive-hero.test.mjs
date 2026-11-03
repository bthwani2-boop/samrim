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

test("delivery messaging remains after the hero and follows core discovery on desktop", () => {
  const campaignAt = discovery.indexOf("const homeCampaignContent = <>");
  const stripAt = discovery.indexOf("styles.deliveryStrip", campaignAt);
  const desktopPlacement = discovery.indexOf("{desktopWebDiscovery ? homeCampaignContent : null}", stripAt);
  const mobilePlacement = discovery.indexOf("{!desktopWebDiscovery ? homeCampaignContent : null}", stripAt);
  const bannerAt = discovery.lastIndexOf("immersiveHeader={heroHeader}");
  const fallback = discovery.indexOf("{!desktopWebDiscovery ? homeCampaignContent : null}");
  const productAt = discovery.indexOf("<HomeProductFeed", discovery.indexOf("taxonomy.verticals.length ? <View", fallback));
  assert.ok(campaignAt >= 0 && stripAt > campaignAt && mobilePlacement > bannerAt);
  assert.ok(desktopPlacement > productAt);
  const campaign = discovery.slice(campaignAt, campaignAt + 1200);
  assert.doesNotMatch(campaign, /75 minutes|free delivery countdown|countdown/i);
});

test("one slide palette spans the full header and media stage without an independently colored header", () => {
  assert.match(banner, /function immersiveSlidePalette\(item: PublicDiscoveryContentView\)/);
  assert.match(banner, /const colors = immersiveSlidePalette\(item\)/);
  assert.match(banner, /Math\.min\(Math\.round\(cardWidth \/ 1\.75\), 384\)/);
  assert.match(banner, /compactDesktopHero[\s\S]*?Math\.min\(Math\.round\(cardWidth \/ 2\.8\), 320\)/);
  assert.match(banner, /mediaHeight \+ \(compactDesktopHero \? 148 : 166\)/);
  assert.match(banner, /Math\.round\(cardWidth \/ \(immersive \? 2\.15 : 1\.75\)\)/);
  assert.match(banner, /locations=\{\[0, \(height - mediaHeight\) \/ height, 1\]\}/);
  assert.match(banner, /start=\{\{ x: 0\.5, y: 0 \}\} end=\{\{ x: 0\.5, y: 1 \}\}/);
  assert.match(banner, /colors=\{\[colors\[1\], colors\[1\] \+ "00"\]\}/);
  assert.doesNotMatch(banner, /items\.findIndex\(\(value\) => value\.id === item\.id\)/);
  assert.match(home, /homeTransparent/);
});

test("web hero scales with discovery content rather than the half-width marketing carousel", () => {
  assert.match(discovery, /const heroCardWidth = Platform\.OS === "web" \?/);
  assert.match(discovery, /Math\.min\(\(discoveryContainerWidth \|\| viewportWidth\) - spacing\[4\], 960\)/);
  assert.match(discovery, /cardWidth=\{heroCardWidth\}/);
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
  assert.match(home, /homeCompact=\{searchOpen \|\| compactHeader\}/);
  assert.match(home, /onSearchOpenChange=\{setSearchVisibility\}/);
  assert.match(shell, /<BthwaniSearchField/);
  assert.doesNotMatch(home, /quickSearch|بحث سريع عن المنتجات|orbScale/);
});

test("published banner artwork is fully contained in its stage instead of cropping promotional text", () => {
  assert.match(banner, /contentFit="contain"/);
});
