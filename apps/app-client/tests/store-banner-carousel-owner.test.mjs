import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const relativeRoot = "../src/features/store-discovery/";
const carousel = readFileSync(new URL(relativeRoot + "store-banner-carousel.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL(relativeRoot + "store-detail.tsx", import.meta.url), "utf8");
const oldStyles = readFileSync(new URL(relativeRoot + "store-detail-styles.ts", import.meta.url), "utf8");

function productionBannerFilter() {
  const tree = ts.createSourceFile("store-banner-carousel.tsx", carousel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = tree.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "displayableStoreBanners");
  assert.ok(fn, "Store banner presentation has exactly one authored eligibility filter");
  const js = ts.transpileModule(`${fn.getText(tree)}\ndisplayableStoreBanners`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(js);
}

test("Store carousel displays only DSH-approved banner images, not reels or unrelated offers", () => {
  const valid = { id: "banner-1", titleAr: "عرض المتجر", kind: "BANNER", mediaKind: "image", mediaUri: "https://example.test/banner.png" };
  const fixture = [
    valid,
    { ...valid, id: "reel", kind: "REEL" },
    { ...valid, id: "video", mediaKind: "video" },
    { ...valid, id: "missing", mediaUri: "" },
    { ...valid, id: "null-media", mediaUri: null },
  ];
  const result = productionBannerFilter()(fixture);
  assert.deepEqual(Array.from(result, (item) => item.id), ["banner-1"]);
  assert.equal(result[0], valid, "preserve DSH-owned content identity and media URI");
  assert.equal(fixture.length, 5, "filter must not mutate the supplied DSH response");
});

test("Carousel owns motion and Arabic accessible display, with one DSH tracking route", () => {
  assert.match(detail, /<StoreBannerCarousel key=/);
  assert.match(detail, /contents=\{marketingContents\}/);
  assert.match(detail, /listPublicStoreBanners\(storeId, selectedCityID\)/);
  assert.match(detail, /async function retryBanners\(\)/);
  assert.doesNotMatch(detail, /setBannerIndex|setReduceMotion|bannerRef\.current|recordDiscoveryImpression/);
  assert.match(carousel, /accessibilityLabel="بنرات المتجر"/);
  assert.match(carousel, /recordDiscoveryImpression\(visibleContentID\)/);
  assert.match(carousel, /recordDiscoveryClick\(content\.id\)/);
  assert.match(carousel, /\/discovery-content\/\$\{encodeURIComponent\(content\.id\)\}/);
  assert.match(carousel, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(carousel, /reduceMotionChanged/);
  assert.match(carousel, /if \(bannerPaused \|\| reduceMotion \|\| items\.length < 2\) return/);
  assert.match(carousel, /\}, 5000\)/);
  assert.match(carousel, /Platform\.OS === "web" \? -1 : 1/);
  assert.match(carousel, /onTouchStart=\{\(\) => setBannerPaused\(true\)\}/);
  assert.match(carousel, /onMomentumScrollEnd=/);
  assert.match(carousel, /accessibilityLabel="مؤشر بنرات المتجر"/);
});

test("Banner styles live only with the carousel and obsolete Store styles are deleted", () => {
  const moved = ["bannerBlock", "storeBannerSlide", "storeBannerImage", "storeBannerCaption", "storeBannerTitle", "storeBannerSubtitle", "storeBannerPagination", "storeBannerDot", "storeBannerDotActive"];
  for (const name of moved) {
    assert.match(carousel, new RegExp("    " + name + ": "));
    assert.doesNotMatch(oldStyles, new RegExp("    " + name + ": "));
  }
  const obsolete = ["catalogPager", "bannerHeading", "bannerHeadingActions", "bannerHeadingText", "bannerPause", "bannerCard", "bannerImage", "bannerImageFallback", "bannerCopy", "bannerItemEyebrow", "bannerProduct", "bannerPrice", "storeInfoRating", "storeInfoRatingCount", "storeInfoSingleMode", "inlineRecovery"];
  for (const name of obsolete) assert.doesNotMatch(oldStyles, new RegExp("    " + name + ": "));
});
