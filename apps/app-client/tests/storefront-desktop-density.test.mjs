import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const feature = path.resolve(import.meta.dirname, "../src/features/store-discovery");
const detail = readFileSync(path.join(feature, "store-detail.tsx"), "utf8");
const styles = readFileSync(path.join(feature, "store-detail-styles.ts"), "utf8");

test("desktop store exposes published products earlier via a compact hero and store summary", () => {
  assert.match(detail, /const desktopStorefront = Platform\.OS === "web" && windowWidth >= 1024/);
  assert.match(detail, /height: \(desktopStorefront \? 144 : 244\) \+ insets\.top/);
  assert.match(detail, /desktopStorefront && styles\.storeInfoDesktop/);
  assert.match(detail, /desktopStorefront \? styles\.storeInfoDesktopSummary/);
  assert.match(styles, /storeInfoDesktop: \{[^}]*marginTop: -24/);
  assert.match(styles, /storeInfoDesktopSummary: \{[^}]*flexDirection: "row"/);
});

test("desktop storefront does not duplicate ordinary catalog offers as promotional banners", () => {
  assert.match(detail, /\.\.\.\(!desktopStorefront \? bannerCatalogOffers\.slice\(0, 5\)\.map/);
  assert.match(detail, /storeMarketingContents\.map/);
  assert.match(detail, /bannerItems\.map/);
  assert.match(detail, /!desktopStorefront && bannerError && bannerItems\.length === 0/);
});

test("compact desktop retains store status, delivery mode selection and mobile presentation", () => {
  assert.match(detail, /availabilitySummary\.label/);
  assert.match(detail, /accessibilityRole="radio"/);
  assert.match(detail, /selectedFulfillmentMode === mode/);
  assert.match(detail, /desktopStorefront \? 144 : 244/);
  assert.match(detail, /gridColumns = Platform\.OS === "web"/);
});
