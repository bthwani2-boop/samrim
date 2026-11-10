import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-store-ratings.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("partner-store-ratings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let focusCallback;
let paginationReset;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") {
    const wrapped = node.arguments[0];
    if (wrapped && ts.isCallExpression(wrapped) && wrapped.expression.getText(ast) === "useCallback") {
      focusCallback = wrapped.arguments[0]?.getText(ast);
    }
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0];
    if (callback && ts.isArrowFunction(callback) && callback.getText(ast).includes("setHistory([])")) {
      paginationReset = callback.getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(focusCallback, "use the actual Partner ratings focus callback");
assert.ok(paginationReset, "use the actual Store/session pagination reset");
const compile = callback => ts.transpileModule(`const run = ${callback};\nrun;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const session = id => partnerSetupSessionKey({
  kind: "authenticated", identity: { role: "partner", subject: "merchant-1", sessionId: id },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((success, fail) => { resolve = success; reject = fail; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const validSummary = { totalRatings: 1, averageRating: 5, oneStar: 0, twoStars: 0, threeStars: 0, fourStars: 0, fiveStars: 1 };
const rating = { orderId: "order-1", storeId: "store-1", rating: 5, review: "خدمة ممتازة", createdAt: "2026-11-11T00:00:00+03:00" };
const result = { ratings: [rating], summary: validSummary, nextCursor: "page-3" };

function focusFixture({ storeId = "store-1", cursor = "" } = {}) {
  const token = deferred();
  const reply = deferred();
  const firstSession = session("login-one");
  const scopeKey = JSON.stringify([firstSession, storeId, cursor]);
  let currentSession = firstSession;
  const events = [];
  const calls = [];
  const capture = kind => value => events.push([kind, value]);
  const context = {
    storeId, cursor, retry: 0, sessionKey: firstSession, scopeKey, PAGE_SIZE: 20,
    setRatings: capture("ratings"),
    setSummary: capture("summary"),
    setLoadedScope: capture("loadedScope"),
    setNextCursor: capture("nextCursor"),
    setError: capture("error"),
    setErrorScope: capture("errorScope"),
    setLoading: capture("loading"),
    currentPartnerSessionKey: () => currentSession,
    getUsableIdentityAccessToken: () => token.promise,
    createDshMobileClient: () => ({
      listPartnerStoreOrderRatings: (...args) => { calls.push(args); return reply.promise; },
    }),
    Crypto: { randomUUID: () => "test-uuid" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://fixture.invalid" } },
  };
  const cleanup = vm.runInNewContext(compile(focusCallback), context)();
  return {
    token, reply, events, calls, scopeKey, cleanup,
    switchSession: () => { currentSession = session("login-two"); },
    signout: () => { currentSession = ""; },
  };
}

test("do not request private Store ratings if the same actor relogs before token resolves", async () => {
  const h = focusFixture();
  h.switchSession();
  h.token.resolve("token-for-login-one");
  await settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.events.some(([kind, value]) => kind === "loadedScope" && value), false);
});

test("discard late private reviews and pagination after same-actor session replacement", async () => {
  const h = focusFixture();
  h.token.resolve("token-one");
  await settle();
  assert.equal(h.calls.length, 1);
  h.switchSession();
  h.reply.resolve(result);
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "ratings" && value?.length), false);
  assert.equal(h.events.some(([kind, value]) => kind === "loadedScope" && value), false);
  assert.equal(h.events.some(([kind, value]) => kind === "nextCursor" && value), false);
});

test("current Identity session reads only the selected Store and page cursor", async () => {
  const h = focusFixture({ cursor: "page-2" });
  h.token.resolve("token-one");
  await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "token-one");
  assert.equal(h.calls[0][1], "store-1");
  assert.equal(h.calls[0][2], 20);
  assert.equal(h.calls[0][3], "page-2");
  h.reply.resolve(result);
  await settle();
  assert.ok(h.events.some(([kind, value]) => kind === "ratings" && value?.[0]?.orderId === "order-1"));
  assert.ok(h.events.some(([kind, value]) => kind === "loadedScope" && value === h.scopeKey));
  assert.ok(h.events.some(([kind, value]) => kind === "nextCursor" && value === "page-3"));
});

test("reject cross-Store ratings even when the DSH request returned a successful response", async () => {
  const h = focusFixture();
  h.token.resolve("token-one");
  await settle();
  h.reply.resolve({ ...result, ratings: [{ ...rating, storeId: "store-other" }] });
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "loadedScope" && value), false);
  assert.ok(h.events.some(([kind, value]) => kind === "errorScope" && value === h.scopeKey));
});

test("reject inconsistent Store rating histogram without displaying a partial summary", async () => {
  const h = focusFixture();
  h.token.resolve("token-one");
  await settle();
  h.reply.resolve({ ...result, summary: { ...validSummary, totalRatings: 2 } });
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "loadedScope" && value), false);
  assert.ok(h.events.some(([kind, value]) => kind === "error" && String(value).includes("تعذرت")));
});

test("on unmount or signout, pending results cannot publish the private review", async () => {
  const h = focusFixture();
  h.token.resolve("token-one");
  await settle();
  h.cleanup();
  h.signout();
  h.reply.resolve(result);
  await settle();
  assert.equal(h.events.some(([kind, value]) => kind === "loadedScope" && value), false);
});

test("pagination reset clears Store history and loaded scope on session and Store changes", () => {
  const events = [];
  vm.runInNewContext(compile(paginationReset), {
    sessionKey: session("login-two"), storeId: "store-2",
    setCursor: value => events.push(["cursor", value]),
    setHistory: value => events.push(["history", value]),
    setLoadedScope: value => events.push(["loadedScope", value]),
    setErrorScope: value => events.push(["errorScope", value]),
  })();
  assert.deepEqual(events.map(([kind]) => kind), ["cursor", "history", "loadedScope", "errorScope"]);
  assert.ok(events.every(([, value]) => value === "" || Array.isArray(value) && value.length === 0));
});

test("render is gated by session + Store + page and retains ratings UX", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /JSON\.stringify\(\[sessionKey, storeId, cursor\]\)/);
  assert.match(source, /currentPartnerSessionKey\(\) === sessionKey/);
  assert.match(source, /sessionCurrent && loadedScope === scopeKey/);
  assert.match(source, /errorScope === scopeKey/);
  assert.doesNotMatch(source, /loadedActor|activeActor|setIdentityState/);
  for (const label of ["تقييمات الطلبات المكتملة", "إعادة قراءة التقييمات", "صفحة التقييمات السابقة", "صفحة التقييمات التالية", "تقييمًا من طلبات مكتملة"]) {
    assert.ok(source.includes(label));
  }
  assert.match(source, /visibleRatings\.map\(rating =>/);
  assert.match(source, /visibleSummary\.averageRating\.toFixed\(1\)/);
  assert.match(source, /ratings\.some\(item => item\.storeId !== storeId\)/);
});
