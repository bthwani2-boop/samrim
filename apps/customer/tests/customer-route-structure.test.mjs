import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const customer = resolve(import.meta.dirname, "..");
const app = resolve(customer, "app");
const read = (path) => readFileSync(resolve(app, path), "utf8");

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

test("all human-approved Customer routes exist in the one Expo app root", () => {
  for (const route of admitted) assert.ok(existsSync(resolve(app, route)), route);
  assert.equal(existsSync(resolve(app, "(app)")), false, "no duplicated navigation group");
  assert.equal(existsSync(resolve(customer, "src/app")), false, "no competing Expo route root");
});

test("Customer home uses the DSH-backed store listing and preserves old /home", () => {
  assert.match(read("(tabs)/index.tsx"), /PublicStoresScreen variant="home"/);
  assert.ok(!read("(tabs)/index.tsx").includes('Redirect href="/stores"'));
  assert.ok(read("home.tsx").includes('Redirect href="/"'));
  const listing = readFileSync(resolve(customer, "src/features/stores/stores-screen.tsx"), "utf8");
  assert.match(listing, /listPublicStores\(/);
  assert.match(listing, /variant === "home"/);
});

test("full Web Store reuses one public DSH reader and preserves native Store link", () => {
  const full = read("storefront/[storeId].tsx");
  const details = readFileSync(resolve(customer, "src/features/stores/store-detail-screen.tsx"), "utf8");
  assert.match(full, /Platform.OS !== "web"/);
  assert.match(full, /robots: \{ index: false, follow: false \}/);
  assert.match(full, /PublicStoreDetail storeID=\{storeId\} fullPage/);
  assert.match(details, /getPublicStore\(/);
  assert.match(details, /listPublicOffers\(/);
  assert.match(details, /fullPage \? 1200 : 800/);
  assert.doesNotMatch(full, /checkout\(|payment\(|wallet\(/);
});

test("future protected and financial routes never offer fake success", () => {
  const pending = admitted.filter((p) => [
    "login.tsx", "verification.tsx", "(tabs)/account/index.tsx",
    "addresses/index.tsx", "addresses/[id].tsx", "cart/[storeId].tsx",
    "checkout/index.tsx", "multi-store-checkout.tsx", "(tabs)/orders/index.tsx",
    "orders/[id].tsx", "notifications/index.tsx", "wallet/index.tsx",
    "wallet-cash-in.tsx", "discovery-content/[contentId].tsx",
  ].includes(p));
  for (const route of pending) {
    assert.match(read(route), /CapabilityUnavailableScreen/, route);
    assert.doesNotMatch(read(route), /fetch\(|checkout\(|confirm\(|credit\(/, route);
  }
  const unavailable = readFileSync(resolve(customer, "src/components/capability-unavailable-screen.tsx"), "utf8");
  assert.match(unavailable, /هذه الخدمة غير مفعّلة حاليًا/);
  assert.match(unavailable, /لن يُرسل هذا القسم طلبًا/);
});

test("Customer tabs are a real navigator and no route duplicates its root URL", () => {
  const tabs = read("(tabs)/_layout.tsx");
  assert.match(tabs, /<Tabs/);
  for (const name of ["index", "orders", "account"]) assert.ok(tabs.includes('name="' + name + '"'));
  for (const old of ["index.tsx", "orders/index.tsx", "account/index.tsx"]) {
    assert.equal(existsSync(resolve(app, old)), false, "duplicate route: " + old);
  }
});
