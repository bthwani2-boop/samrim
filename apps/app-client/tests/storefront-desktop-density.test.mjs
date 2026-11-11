import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feature = path.resolve(import.meta.dirname, "../src/features/store-discovery");
const detail = readFileSync(path.join(feature, "store-detail.tsx"), "utf8");
const banners = readFileSync(path.join(feature, "store-banner-carousel.tsx"), "utf8");
const styles = readFileSync(path.join(feature, "store-detail-styles.ts"), "utf8");

test("desktop store exposes published products earlier via a compact hero and store summary", () => {
  assert.match(detail, /const desktopStorefront = Platform\.OS === "web" && windowWidth >= 1024/);
  assert.match(detail, /const storeHeroHeight = desktopStorefront \? 196 : Platform\.OS === "web" \? 214 : 244/);
  assert.match(detail, /height: storeHeroHeight \+ insets\.top/);
  assert.match(detail, /desktopStorefront && styles\.storeInfoDesktop/);
  assert.match(detail, /desktopStorefront \? styles\.storeInfoDesktopSummary/);
  assert.match(styles, /storeInfoDesktop: \{[^}]*marginTop: -24/);
  assert.match(styles, /storeInfoDesktopSummary: \{[^}]*flexDirection: "row"/);
});

test("desktop storefront does not duplicate ordinary catalog offers as promotional banners", () => {
  assert.match(detail, /listPublicStoreBanners\(storeId, selectedCityID\)/);
  assert.doesNotMatch(detail, /bannerCatalogOffers/);
  assert.match(detail, /<StoreBannerCarousel/);
  assert.match(banners, /displayableStoreBanners/);
  assert.match(banners, /items\.map/);
  assert.match(banners, /accessibilityLabel="بنرات المتجر"/);
});

test("compact desktop retains store status, delivery mode selection and mobile presentation", () => {
  assert.match(detail, /availabilitySummary\.label/);
  assert.match(detail, /accessibilityRole="radio"/);
  assert.match(detail, /selectedFulfillmentMode === mode/);
  assert.match(detail, /storeHeroHeight \+ insets\.top - 32/);
  assert.match(detail, /gridColumns = Platform\.OS !== "web" \? 2 : windowWidth >= 1700 \? 5/);
});
