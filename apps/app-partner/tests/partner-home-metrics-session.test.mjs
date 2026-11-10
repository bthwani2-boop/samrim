import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const read = file => readFileSync(new URL("../src/features/partner-onboarding/" + file, import.meta.url), "utf8");
const peek = read("partner-performance-peek.tsx");
const desktop = read("partner-desktop-home.tsx");
const session = id => partnerSetupSessionKey({
  kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: id },
});
const defer = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function sourceFocusCallback(source) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") {
      const wrapped = node.arguments[0];
      if (wrapped && ts.isCallExpression(wrapped) && wrapped.expression.getText(ast) === "useCallback") {
        callback = wrapped.arguments[0]?.getText(ast);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, "load actual focus callback from production source");
  return ts.transpileModule("const run = " + callback + ";\nrun;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function peekFixture() {
  const token = defer();
  const reply = defer();
  const first = session("session-a");
  let currentSession = first;
  let apiCalls = 0;
  const events = [];
  const context = {
    sessionKey: first, scopeKey: JSON.stringify([first, "store-a"]),
    store: { id: "store-a", owned: true }, currentPartnerSessionKey: () => currentSession,
    getUsableIdentityAccessToken: () => token.promise,
    createDshMobileClient: () => ({
      readOwnPartnerFinancialSummary: () => { apiCalls++; return reply.promise; },
    }),
    setData: value => events.push(["data", value]),
    setLoadedScope: value => events.push(["scope", value]),
    Crypto: { randomUUID: () => "test-id" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://local.invalid" } },
  };
  const run = vm.runInNewContext(sourceFocusCallback(peek), context);
  const cleanup = run();
  return {
    token, reply, events, cleanup,
    replaceSession: () => { currentSession = session("session-b"); },
    get apiCalls() { return apiCalls; },
  };
}

test("mobile financial peek never sends request after token resolution from replaced session", async () => {
  const h = peekFixture();
  h.token.resolve("token-a");
  h.replaceSession();
  await settle();
  assert.equal(h.apiCalls, 0);
  assert.equal(h.events.some(([kind, value]) => kind === "data" && value !== null), false);
});

test("mobile financial peek discards late finance read after same-actor session replacement", async () => {
  const h = peekFixture();
  h.token.resolve("token-a");
  await settle();
  assert.equal(h.apiCalls, 1);
  h.replaceSession();
  h.reply.resolve({ summary: { stores: [{ storeId: "store-a", earnedMinor: 400, orderCount: 2, attributionComplete: true }] } });
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "data" && value !== null), false);
});

test("mobile financial peek shows only attribution-complete matching Store in same session", async () => {
  const h = peekFixture();
  h.token.resolve("token-a");
  await settle();
  h.reply.resolve({ summary: { stores: [
    { storeId: "store-b", earnedMinor: 900, orderCount: 9, attributionComplete: true },
    { storeId: "store-a", earnedMinor: 400, orderCount: 2, attributionComplete: true },
  ] } });
  await settle();
  assert.equal(h.events.find(([kind, value]) => kind === "data" && value?.earnedMinor)?.[1].earnedMinor, 400);
  assert.ok(h.events.some(([kind, value]) => kind === "scope" && String(value).includes("store-a")));
});

function desktopFixture() {
  const token = defer();
  const offers = defer();
  const first = session("session-a");
  let currentSession = first;
  let apiCalls = 0;
  const events = [];
  const store = { id: "store-a", owned: false, serviceCityId: "city-a", publicationState: "draft" };
  const context = {
    empty: {},
    sessionKey: first, scopeKey: JSON.stringify([first, store.id]), store,
    canOrders: false, canCatalog: true, canFinance: false, marketplace: false,
    currentPartnerSessionKey: () => currentSession,
    getUsableIdentityAccessToken: () => token.promise,
    createDshMobileClient: () => ({
      readOwnStoreOffers: () => { apiCalls++; return offers.promise; },
      readOwnStoreInventorySummary: async () => null,
    }),
    setStoredData: value => events.push(["data", value]),
    setVisibleScopeKey: value => events.push(["scope", value]),
    setLoading: value => events.push(["loading", value]),
    scopedCatalogInventorySummary: () => null,
    scopedPartnerPopularOffers: () => null,
    Crypto: { randomUUID: () => "test-id" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://local.invalid" } },
  };
  const run = vm.runInNewContext(sourceFocusCallback(desktop), context);
  const cleanup = run();
  return {
    token, offers, events, cleanup,
    replaceSession: () => { currentSession = session("session-b"); },
    get apiCalls() { return apiCalls; },
  };
}

test("desktop dashboard drops obsolete token before starting Store API operations", async () => {
  const h = desktopFixture();
  h.token.resolve("token-a");
  h.replaceSession();
  await settle();
  assert.equal(h.apiCalls, 0);
  assert.equal(h.events.some(([kind, value]) => kind === "scope" && value), false);
});

test("desktop dashboard drops late Store metrics after session replacement", async () => {
  const h = desktopFixture();
  h.token.resolve("token-a");
  await settle();
  assert.equal(h.apiCalls, 1);
  h.replaceSession();
  h.offers.resolve({ offers: [{ id: "item-a" }] });
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "scope" && value), false);
  assert.equal(h.events.some(([kind, value]) => kind === "data" && value.offers?.length), false);
});

test("desktop dashboard can publish current-session Store metrics only after owner readbacks", async () => {
  const h = desktopFixture();
  h.token.resolve("token-a");
  await settle();
  h.offers.resolve({ offers: [{ id: "item-a" }] });
  await settle();
  assert.equal(h.events.find(([kind, value]) => kind === "data" && value.offers?.length)?.[1].offers[0].id, "item-a");
  assert.ok(h.events.some(([kind, value]) => kind === "scope" && String(value).includes("store-a")));
});

test("mobile and desktop immediately hide previous Store/session data during render", () => {
  assert.match(peek, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(peek, /loadedScope === scopeKey \? data : null/);
  assert.match(peek, /if \(!stillCurrent\(\)\) return;\s*const api/);
  assert.match(peek, /if \(!stillCurrent\(\)\) return;\s*const summary/);
  assert.match(desktop, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(desktop, /visibleScopeKey === scopeKey \? storedData : empty/);
  assert.match(desktop, /if \(!stillCurrent\(\)\) return;\s*const \[orders/);
  assert.match(desktop, /if \(!stillCurrent\(\)\) return;\s*const orderPage/);
});

test("existing Store metrics, routes, RTL and access gates survive refoundation", () => {
  for (const label of ["ملخص المتجر المالي", "مستحقات مكتسبة", "طلبات مسوّاة"]) assert.ok(peek.includes(label));
  for (const label of ["طلبات ٧ أيام", "المنتجات المتاحة", "تجهيز المتجر وتشغيله"]) assert.ok(desktop.includes(label));
  assert.match(peek, /router\.push\("\/insights\?returnTo=more"/);
  assert.match(desktop, /readOwnPartnerFinancialSummary\(token\)/);
  assert.match(desktop, /readOwnStoreInventorySummary\(token, store\.id\)/);
  assert.match(desktop, /scopedPartnerPopularOffers\(store\.id, popularPage\)/);
  assert.match(desktop, /financePage\?\.summary\.stores\.find\(item => item\.storeId === store\.id\)/);
});
