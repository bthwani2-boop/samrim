import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const customer = resolve(import.meta.dirname, "..");
const app = resolve(customer, "app");
const read = (path) => readFileSync(resolve(app, path), "utf8");
const readFeature = (path) => readFileSync(resolve(customer, "src/features", path), "utf8");

const admitted = [
  "_layout.tsx", "+html.tsx", "(tabs)/_layout.tsx", "(tabs)/index.tsx", "home.tsx",
  "stores/index.tsx", "store/[id].tsx", "storefront/[storeId].tsx",
  "login.tsx", "verification.tsx", "(tabs)/account/index.tsx",
  "addresses/index.tsx", "addresses/[id].tsx", "cart/[storeId].tsx",
  "checkout/index.tsx", "multi-store-checkout.tsx",
  "(tabs)/orders/index.tsx", "orders/[id].tsx", "notifications/index.tsx",
  "wallet/index.tsx", "wallet-cash-in.tsx",
  "discovery-content/[contentId].tsx",
];

test("all Customer URLs remain under the single Expo Router app root", () => {
  for (const route of admitted) assert.ok(existsSync(resolve(app, route)), route);
  assert.equal(existsSync(resolve(app, "(app)")), false);
  assert.equal(existsSync(resolve(customer, "src/app")), false);
});

test("home still uses the DSH listing and preserves /home deep links", () => {
  assert.match(read("(tabs)/index.tsx"), /PublicStoresScreen variant="home"/);
  assert.ok(read("home.tsx").includes('Redirect href="/"'));
  const listing = readFeature("stores/stores-screen.tsx");
  assert.match(listing, /listPublicStores\(/);
  assert.match(listing, /variant === "home"/);
  assert.match(listing, /ServiceCityScope/);
});

test("web storefront keeps its no-index policy and reuses the DSH reader", () => {
  const full = read("storefront/[storeId].tsx");
  const storefront = readFeature("stores/storefront-screen.tsx");
  const details = readFeature("stores/store-detail-screen.tsx");
  assert.match(full, /Platform.OS !== "web"/);
  assert.match(full, /robots: \{ index: false, follow: false \}/);
  assert.match(full, /StorefrontScreen storeId=\{storeId\}/);
  assert.match(storefront, /PublicStoreDetail storeID=\{storeId\} fullPage/);
  assert.match(details, /getPublicStore\(/);
  assert.match(details, /listPublicOffers\(/);
  assert.match(details, /fullPage \? 1200 : 800/);
  assert.match(details, /StoreProducts/);
  assert.doesNotMatch(full, /checkout\(|payment\(|wallet\(/);
});

test("protected feature routes delegate to feature-owned screens and fail closed", () => {
  const routes = {
    "addresses/index.tsx": "addresses/addresses-screen.tsx",
    "addresses/[id].tsx": "addresses/address-editor.tsx",
    "cart/[storeId].tsx": "cart/cart-screen.tsx",
    "checkout/index.tsx": "checkout/checkout-screen.tsx",
    "multi-store-checkout.tsx": "multi-store-checkout/multi-store-checkout-screen.tsx",
    "(tabs)/orders/index.tsx": "orders/orders-screen.tsx",
    "orders/[id].tsx": "orders/order-detail-screen.tsx",
    "notifications/index.tsx": "notifications/notifications-inbox.tsx",
    "wallet/index.tsx": "wallet/wallet-screen.tsx",
    "wallet-cash-in.tsx": "wallet/cash-in-panel.tsx",
    "discovery-content/[contentId].tsx": "discovery/discovery-content-screen.tsx",
  };
  for (const [route, screen] of Object.entries(routes)) {
    assert.match(read(route), /export \{ default \} from/, route);
    const source = readFeature(screen);
    assert.match(source, /CapabilityUnavailableScreen/, screen);
    assert.doesNotMatch(source, /fetch\(|checkout\(|confirm\(|credit\(/, screen);
  }
  assert.ok(read("login.tsx").includes('export { default } from'));
  assert.ok(read("verification.tsx").includes('export { default } from'));
  assert.ok(readFeature("access/identity-gate.tsx").includes("readCustomerAdmission"));
  assert.ok(readFeature("access/verification-screen.tsx").includes('from "./identity-gate"'));
  assert.match(read("(tabs)/account/index.tsx"), /export \{ default \} from/);
  const account = readFeature("account/account-screen.tsx");
  assert.match(account, /href="\/login"/);
  assert.match(account, /<AccountPreferences/);
  assert.doesNotMatch(account, /fetch\(|checkout\(|confirm\(|credit\(/);
  const unavailable = readFileSync(resolve(customer, "src/components/capability-unavailable-screen.tsx"), "utf8");
  assert.match(unavailable, /هذه الخدمة غير مفعّلة حاليًا/);
  assert.match(unavailable, /لن يُرسل هذا القسم طلبًا/);
});

test("tabs keep their URLs and no route duplicates their roots", () => {
  const tabs = read("(tabs)/_layout.tsx");
  assert.match(tabs, /<Tabs/);
  for (const name of ["index", "orders/index", "account/index"]) assert.ok(tabs.includes(`name: "${name}"`));
  assert.match(tabs, /tabBarPosition: "left"/);
  assert.match(tabs, /href="\/stores"/, "public Store discovery remains reachable in the desktop shell");
  for (const duplicate of ["index.tsx", "orders/index.tsx", "account/index.tsx"]) {
    assert.equal(existsSync(resolve(app, duplicate)), false);
  }
});
