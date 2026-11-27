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
  assert.equal(existsSync(resolve(app, "health.tsx")), false, "retired synthetic health route");
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
    "(tabs)/orders/index.tsx": "orders/orders-screen.tsx",
    "orders/[id].tsx": "orders/order-detail-screen.tsx",
    "notifications/index.tsx": "notifications/notifications-inbox.tsx",
    "wallet-cash-in.tsx": "wallet/cash-in-panel.tsx",
    "discovery-content/[contentId].tsx": "discovery/discovery-content-screen.tsx",
  };
  for (const [route, screen] of Object.entries(routes)) {
    assert.match(read(route), /export \{ default \} from/, route);
    const source = readFeature(screen);
    assert.match(source, /CapabilityUnavailableScreen/, screen);
    assert.doesNotMatch(source, /fetch\(|checkout\(|confirm\(|credit\(/, screen);
  }
  assert.match(read("multi-store-checkout.tsx"), /export \{ default \} from/);
  const multiStore = readFeature("multi-store-checkout/multi-store-checkout-screen.tsx");
  assert.match(multiStore, /readVerifiedCartDirectory\(/);
  assert.match(multiStore, /checkout-confirmation-unavailable/);
  assert.doesNotMatch(multiStore, /fetch\(|createOrder\(|confirmOrder\(|credit\(|debit\(/);
  for (const route of ["addresses/index.tsx","addresses/[id].tsx"]) {
    assert.match(read(route), /addresses\/addresses-screen/);
  }
  const addresses = readFeature("addresses/addresses-screen.tsx");
  assert.match(addresses, /readVerifiedAddresses\(/);
  assert.match(addresses, /writeVerifiedAddress\(/);
  assert.doesNotMatch(addresses, /fetch\(|AsyncStorage|SecureStore/);
  assert.match(read("checkout/index.tsx"), /export \{ default \} from/);
  const checkoutScreen = readFeature("checkout/checkout-screen.tsx");
  assert.match(checkoutScreen, /readVerifiedCart\(storeId,/);
  assert.match(checkoutScreen, /checkout-confirmation-unavailable/);
  assert.doesNotMatch(checkoutScreen, /fetch\(|createOrder\(|confirmOrder\(|walletDebit\(|charge\(/);  assert.match(read("cart/[storeId].tsx"), /export \{ default \} from/);
  const cartScreen = readFeature("cart/cart-screen.tsx");
  assert.match(cartScreen, /readVerifiedCart\(/);
  assert.match(cartScreen, /replaceVerifiedCart\(/);
  assert.doesNotMatch(cartScreen, /fetch\(|checkout\(|confirm\(|credit\(|debit\(/);
  const cartTransport = readFeature("cart/cart-transport.ts");
  assert.match(cartTransport, /readCurrentCustomerCart\(/);
  assert.match(cartTransport, /replaceCurrentCustomerCart\(/);
  assert.match(cartTransport, /OPERATION_RESULT_UNKNOWN/);
  const nativeWallet = readFeature("wallet/wallet-screen.tsx");
  assert.match(read("wallet/index.tsx"), /export \{ default \} from/);
  assert.match(nativeWallet, /readNativeWallet\(/);
  assert.match(nativeWallet, /readNativeWalletTransactions\(/);
  assert.doesNotMatch(nativeWallet, /fetch\(|credit\(|debit\(/);
  assert.ok(read("login.tsx").includes('export { default } from'));
  assert.ok(read("verification.tsx").includes('export { default } from'));
  assert.ok(readFeature("access/identity-gate.tsx").includes("readCustomerAdmission"));
  assert.ok(readFeature("access/verification-screen.tsx").includes('from "./identity-gate"'));
  assert.match(read("(tabs)/account/index.tsx"), /export \{ default \} from/);
  const account = readFeature("account/account-screen.tsx");
  assert.match(account, /href="\/login"/);
  assert.match(account, /<AppearancePreferences/);
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

test("Customer account exposes the existing protected wallet and signed-out wallets return through login", () => {
  const account = readFeature("account/account-screen.tsx");
  assert.match(account, /href="\/wallet"/);
  for (const screen of ["wallet-screen.tsx", "wallet-screen.web.tsx"]) {
    assert.match(readFeature(`wallet/${screen}`), /pathname: "\/login", params: \{ returnTo: "\/wallet" \}/);
  }
  const identity = readFeature("access/identity-gate.tsx");
  assert.match(identity, /customerAuthDestination\(returnTo\)/);
  assert.match(identity, /enabled && session \? \(/);
  assert.match(identity, /href=\{destination\}/);
});

test("Account city shortcut and address login continuation reuse admitted routes", () => {
  const account = readFeature("account/account-screen.tsx");
  assert.match(account, /pathname: "\/stores", params: \{ chooseCity: "1" \}/);
  assert.match(readFeature("addresses/addresses-screen.tsx"), /pathname: "\/login", params: \{ returnTo: "\/addresses" \}/);
});
