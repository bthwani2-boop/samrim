import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const file = path.resolve(import.meta.dirname, "../src/features/store-discovery/store-directory-card.tsx");
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && ["StoreDirectoryCard", "makeStyles"].includes(node.name?.text))
  .map((node) => node.getText(ast).replace(/^export /, "")).join("\n");
const compiled = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const React = { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; } };
const context = {
  React,
  useAppearanceTheme: () => ({
    surface: "surface", surfaceInset: "inset", actionSoft: "soft", interactiveText: "action", color: "body",
    colorMuted: "muted", success: "green", successSoft: "palegreen", warning: "orange", borderColor: "border",
  }),
  useMemo: (fn) => fn(),
  availableCustomerFulfillmentModes: (modes) => modes ?? [],
  fulfillmentModeLabel: (mode) => mode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : mode === "CUSTOMER_PICKUP" ? "استلام من المتجر" : "توصيل بثواني",
  BthwaniIcon: "Icon", Text: "Text", View: "View", Pressable: "Pressable", Image: "Image",
  StyleSheet: { create: (styles) => styles },
  borders: { hairline: 1 }, elevation: { raised: {} }, radius: { xl: 16, round: 999 }, sizing: { iconLg: 24, controlMd: 40 },
  spacing: { 1: 4, 2: 8 }, typography: { titleSm: {}, caption: {} },
};
const StoreDirectoryCard = vm.runInNewContext(compiled + "\nStoreDirectoryCard", context);
const store = (changes = {}) => ({
  id: "store-1", name: "سوبر ماركت الخير", addressLine: "صنعاء",
  fulfillmentModes: ["PARTNER_CAPTAIN"], orderabilityByMode: [{ fulfillmentMode: "PARTNER_CAPTAIN", state: "OPEN_FOR_ORDERS" }],
  ratingCount: 0, ratingAverage: 0, storeProfileImage: { uri: "https://example.test/logo.png" },
  storeCoverImage: { uri: "https://example.test/cover.png" }, distanceMeters: null, ...changes,
});
function render(changes = {}, extra = {}) {
  return StoreDirectoryCard({
    store: store(changes), activityLabel: "مقاضي", favorite: false, favoriteBusy: false,
    imageFailed: false, onImageError: () => {}, onOpen: () => {}, onFavorite: () => {},
    promotionCount: 0, ...extra,
  });
}
function descendants(element, type) {
  if (!element || typeof element !== "object") return [];
  return [...(element.type === type ? [element] : []), ...(element.children ?? []).flatMap((child) => descendants(child, type))];
}
function visibleText(element) {
  return descendants(element, "Text").flatMap((node) => node.children).filter((v) => typeof v === "string").join(" | ");
}

test("uses the store logo only, without reading cover images or cropping the logo", () => {
  const element = render();
  const images = descendants(element, "Image");
  assert.equal(images.length, 1);
  assert.equal(images[0].props.source.uri, "https://example.test/logo.png");
  assert.equal(images[0].props.resizeMode, "contain");
  assert.ok(!source.includes("store.storeCoverImage"), "card must not use cover image");
  assert.ok(element.props.style({ pressed: false }).some((value) => value.minHeight === 116));
});

test("missing or failed logo has a simple store icon fallback", () => {
  assert.equal(descendants(render({ storeProfileImage: null }), "Image").length, 0);
  assert.equal(descendants(render({}, { imageFailed: true }), "Icon").length, 1);
});

test("hides missing ratings, missing offers and undefined location, while retaining genuine state and service", () => {
  const text = visibleText(render());
  assert.match(text, /سوبر ماركت الخير/);
  assert.match(text, /مفتوح/);
  assert.match(text, /توصيل المتجر/);
  assert.doesNotMatch(text, /لا تقييمات|عروض|تجهيز|غير محدد/);
  const minimal = visibleText(render({ addressLine: " ", ratingCount: 0, fulfillmentModes: [], orderabilityByMode: [] }, { activityLabel: "" }));
  assert.match(minimal, /سوبر ماركت الخير/);
  assert.doesNotMatch(minimal, /غير محدد|لا تقييمات|التوفر غير مؤكد/);
});

test("different orderability states and real benefits are grounded in store data", () => {
  const paused = visibleText(render({ orderabilityByMode: [{ fulfillmentMode: "PARTNER_CAPTAIN", state: "PAUSED" }] }));
  assert.match(paused, /متوقف مؤقتًا/);
  const closed = visibleText(render({ orderabilityByMode: [{ fulfillmentMode: "PARTNER_CAPTAIN", state: "CLOSED_BY_SCHEDULE" }] }));
  assert.match(closed, /مغلق/);
  const unavailable = visibleText(render({ orderabilityByMode: [{ fulfillmentMode: "PARTNER_CAPTAIN", state: "OPERATIONALLY_UNAVAILABLE" }] }));
  assert.match(unavailable, /غير متاح/);
  const rated = visibleText(render({ ratingCount: 12, ratingAverage: 4.3 }, { promotionCount: 2 }));
  assert.match(rated, /4\.3/);
  assert.match(rated, /2 عروض/);
  assert.match(visibleText(render({}, { promotionCount: 1 })), /عرض متاح/);
});

test("favorite press remains separate from opening the store", () => {
  let openCount = 0;
  let favoriteCount = 0;
  let stopped = false;
  const element = render({}, { onOpen: () => openCount++, onFavorite: () => favoriteCount++ });
  const heart = descendants(element, "Pressable").find((node) => String(node.props.accessibilityLabel).includes("المفضلة"));
  assert.ok(heart);
  heart.props.onPress({ stopPropagation() { stopped = true; } });
  assert.equal(favoriteCount, 1);
  assert.equal(openCount, 0);
  assert.equal(stopped, true);
  element.props.onPress();
  assert.equal(openCount, 1);
});

test("failed-image state is scoped by store id and logo URI to allow refreshed approved logos", () => {
  const directory = readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-discovery.tsx"), "utf8");
  const expected = 'JSON.stringify([store.id, store.storeProfileImage?.uri ?? ""])';
  assert.ok(directory.includes("imageFailed={failedStoreImageIDs.has(" + expected + ")}"));
  assert.ok(directory.includes("new Set(current).add(" + expected + ")"));
});

test("rating is directly beneath the logo rather than in the center or status column", () => {
  const root = render({ ratingCount: 18, ratingAverage: 4.8 });
  const columns = root.children.filter((item) => item?.type === "View");
  assert.equal(columns.length, 3);
  const [logoColumn, contentColumn, actionColumn] = columns;
  assert.equal(logoColumn.props.style.width, 84);
  assert.equal(descendants(logoColumn, "Image").length, 1);
  assert.match(visibleText(logoColumn), /★.*4\.8/s);
  assert.doesNotMatch(visibleText(contentColumn), /4\.8/);
  assert.doesNotMatch(visibleText(actionColumn), /4\.8/);
  assert.equal(descendants(render({ ratingCount: 0, ratingAverage: 0 }), "Image").length, 1);
  assert.doesNotMatch(visibleText(render({ ratingCount: 0 })), /★/);
  assert.doesNotMatch(visibleText(render({ ratingCount: 12, ratingAverage: 8 })), /★/);
});

test("status and favorite are vertically aligned in a single fixed left column", () => {
  const root = render();
  const actionColumn = root.children.at(-1);
  assert.equal(actionColumn.props.style.width, 66);
  assert.equal(actionColumn.props.style.alignItems, "center");
  assert.equal(descendants(actionColumn, "Pressable").length, 1);
  assert.match(visibleText(actionColumn), /مفتوح/);
  assert.match(visibleText(actionColumn), /♡/);
  assert.doesNotMatch(visibleText(root.children.at(1)), /مفتوح/);
});

test("short and long store names share the same native RTL text column without forced alignment", () => {
  for (const name of ["سام", "سوبر ماركت الخير"]) {
    const column = render({ name }).children[1];
    assert.equal(column.props.style.flex, 1);
    assert.equal(column.props.style.minWidth, 0);
    assert.equal(column.props.style.alignItems, undefined);
    for (const field of column.children.filter((item) => item?.type === "Text")) {
      assert.equal(field.props.style.textAlign, undefined);
      assert.equal(field.props.style.writingDirection, undefined);
      assert.equal(field.props.style.direction, undefined);
    }
  }
});

test("store card never invents arrival estimates or distance in the catalog", () => {
  const root = render({ distanceMeters: 1200, ratingCount: 0 });
  const text = visibleText(root);
  assert.doesNotMatch(text, /دقيقة|1\.2 كم|لا تقييمات بعد/);
  assert.match(text, /توصيل المتجر/);
  assert.doesNotMatch(source, /storeCoverImage|preparationMinutes/);
});
