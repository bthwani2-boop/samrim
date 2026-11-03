import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feature = path.resolve(import.meta.dirname, "../src/features/store-discovery");
const discovery = readFileSync(path.join(feature, "store-discovery.tsx"), "utf8");
const banner = readFileSync(path.join(feature, "looping-hero-banner.tsx"), "utf8");
const styles = readFileSync(path.join(feature, "store-discovery-styles.ts"), "utf8");
const productFeed = readFileSync(path.join(feature, "home-product-feed.tsx"), "utf8");
const shell = readFileSync(path.resolve(import.meta.dirname, "../src/shell/client-shell.tsx"), "utf8");

test("desktop discovery keeps the full interactive header and contained image in a shorter hero", () => {
  assert.match(banner, /const mediaHeight = immersive && Platform\.OS === "web"[\s\S]*?Math\.min\(Math\.round\(cardWidth \/ 2\.8\), 320\)/);
  assert.match(banner, /mediaHeight \+ \(compactDesktopHero \? 148 : 166\)/);
  assert.match(banner, /contentFit="contain"/);
  assert.match(banner, /compactDesktopHero = false/);
  assert.match(banner, /immersiveHeader \? <View style=\{\{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 5 \}\}/);
});

test("desktop navigation gives discovery more width without hiding or renaming destinations", () => {
  assert.match(shell, /desktopNavigation: \{[^}]*width: 176, minWidth: 176, maxWidth: 176/);
  assert.match(shell, /const icons = \{ home: "home", orders: "orders", account: "account" \}/);
  assert.match(shell, /tabBarLabelStyle: styles\.navigationLabel/);
  assert.match(shell, /desktopNavigationItem: \{[^}]*minHeight: sizing\.controlLg/);
});

test("real categories and DSH-backed products precede secondary campaign content on desktop home", () => {
  assert.match(discovery, /const desktopWebDiscovery = Platform\.OS === "web" && viewportWidth >= 1024/);
  const fallback = discovery.indexOf("{!desktopWebDiscovery ? homeCampaignContent : null}");
  const categories = discovery.indexOf("taxonomy.verticals.length ? <View", fallback);
  const feed = discovery.indexOf("<HomeProductFeed", categories);
  const desktopCampaign = discovery.lastIndexOf("{desktopWebDiscovery ? homeCampaignContent : null}");
  assert.ok(categories >= 0 && feed > categories && desktopCampaign > feed);
  assert.match(discovery, /compactDesktopHero=\{desktopWebDiscovery\}/);
  const publishedBanner = discovery.indexOf("items={bannerContent.slice(0, section.count)}");
  const compactFallbackBanner = discovery.indexOf("compactDesktopHero={desktopWebDiscovery}");
  assert.ok(publishedBanner >= 0 && compactFallbackBanner > publishedBanner);
  assert.doesNotMatch(discovery.slice(publishedBanner, compactFallbackBanner), /compactDesktopHero/);
  assert.match(discovery, /const homeCampaignContent = <>[\s\S]*?styles\.deliveryStrip[\s\S]*?styles\.featuredPromotion/);
  assert.match(productFeed, /searchPublicCatalog\(cityID, normalizedQuery, categoryID, effectivePageSize/);
  assert.match(styles, /activityTileDesktop: \{[^}]*minHeight: 38/);
});
