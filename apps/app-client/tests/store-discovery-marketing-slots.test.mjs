import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const file = path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx");
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("marketing types have distinct eligible home placements without client-authored banners", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const [kind, name] of [["BANNER", "bannerContent"], ["CAROUSEL", "carouselContent"]]) {
    assert.match(source, new RegExp("const " + name + " = useMemo"));
    assert.ok(source.includes('item.kind === "' + kind + '" && Boolean(item.mediaUri)'));
  }
  assert.match(source, /const videoShorts = useMemo/);
  assert.match(source, /item.kind === "SHORT_FORM" && item.mediaKind === "video"/);
  const banner = source.indexOf('items={bannerContent}');
  const categories = source.indexOf('accessibilityLabel="المجالات التجارية الرئيسية"');
  const carousel = source.indexOf('items={carouselContent}');
  const stories = source.indexOf('style={styles.storeFilterRow}');
  assert.ok(banner > 0 && categories > banner && carousel > categories && stories > carousel);
  assert.match(source, /showHomeMarketing && bannerContent.length/);
  assert.match(source, /showHomeMarketing && hasMarketingItems/);
  assert.match(source, /item\.mediaUri/);
  assert.match(source, /onOpen=\{\(item\) => openDiscoveryContent\(item.id\)\}/);
  assert.match(source, /accessibilityLabel="ريلز"/);
  assert.doesNotMatch(source, /shortFormCard|items=\{shortFormContent\}|shortForm\s*\/\>/);

});

test("marketing cards retain published-media fallback, click route and impression tracking", () => {
  assert.match(source, /onError=\{\(\) => setFailedMedia/);
  assert.match(source, /recordDiscoveryImpression\(activeItem.id\)/);
  assert.match(source, /recordDiscoveryClick\(contentId\)/);
  assert.match(source, /router\.push\(`\/discovery-content\//);
});
