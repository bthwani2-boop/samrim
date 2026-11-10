import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/store-offer/partner-store-reels.tsx", import.meta.url), "utf8");
const syntax = ts.createSourceFile("partner-store-reels.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
let scopeEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    let callback = node.initializer;
    if (callback && ts.isCallExpression(callback) && callback.expression.getText(syntax) === "useCallback") {
      callback = callback.arguments[0];
    }
    if (callback && ts.isArrowFunction(callback)) callbacks.set(node.name.text, callback.getText(syntax));
  }
  if (ts.isCallExpression(node) && node.expression.getText(syntax) === "useEffect") {
    const callback = node.arguments[0];
    if (callback?.getText(syntax).includes("uploadRequest.current++")) scopeEffect = callback.getText(syntax);
  }
  ts.forEachChild(node, visit);
}
visit(syntax);
for (const name of ["read", "loadAnalytics", "choose", "submit"]) {
  assert.ok(callbacks.has(name), `actual ${name} production callback must be extracted`);
}
assert.ok(scopeEffect, "the real Store/Identity reset effect must be used");
function compile(expr) {
  return ts.transpileModule(`const run = ${expr};\nrun;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const createCallback = (name, context) => vm.runInNewContext(compile(callbacks.get(name)), context);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const session = id => partnerSetupSessionKey({
  kind: "authenticated",
  identity: { role: "partner", subject: "merchant-a", sessionId: id },
});
const mockResponse = value => ({ ok: true, json: async () => value });

function fixture() {
  const token = deferred();
  const list = deferred();
  const targets = deferred();
  const analytics = deferred();
  const post = deferred();
  const picker = deferred();
  const sessionKey = session("login-one");
  const storeId = "store-a";
  const scopeKey = JSON.stringify([sessionKey, storeId]);
  let currentSession = sessionKey;
  let uuid = 0;
  const activeScope = { current: scopeKey };
  const readRequest = { current: 0 };
  const analyticsRequest = { current: 0 };
  const uploadRequest = { current: 0 };
  const uploadBusyScope = { current: "" };
  const attempt = { current: null };
  const events = [];
  const fetchCalls = [];
  const analyticsCalls = [];
  const formFields = [];
  const capture = name => value => events.push([name, value]);
  const file = { name: "video.mp4", uri: "file:///video.mp4", size: 3000, mimeType: "video/mp4" };
  class MockFormData {
    constructor() { this.fields = []; formFields.push(this.fields); }
    append(key, value) { this.fields.push([key, value]); }
  }
  let readCalls = 0;
  const context = {
    sessionKey, scopeKey, storeId, storeName: "متجر تجريبي",
    activeScope, readRequest, analyticsRequest, uploadRequest, uploadBusyScope, attempt,
    visibleBusy: false, visibleFile: file, caption: "فيديو أصلي للمتجر",
    rights: true, targetId: storeId, targetType: "STORE", busy: false,
    currentPartnerSessionKey: () => currentSession,
    scopeCurrent: () => Boolean(currentSession) && currentSession === sessionKey && activeScope.current === scopeKey,
    getUsableIdentityAccessToken: () => token.promise,
    baseUrl: () => "https://dsh.fixture.invalid",
    fetch: (url, options) => {
      fetchCalls.push([url, options]);
      if (options?.method === "POST") return post.promise;
      return url.endsWith("/discovery-targets") ? targets.promise : list.promise;
    },
    createDshMobileClient: () => ({
      listPartnerStoreContentAnalytics: (...args) => {
        analyticsCalls.push(args);
        return analytics.promise;
      },
    }),
    DocumentPicker: { getDocumentAsync: () => picker.promise },
    Crypto: { randomUUID: () => `uuid-${++uuid}` },
    FormData: MockFormData,
    setItems: capture("items"), setTargets: capture("targets"),
    setReadScope: capture("readScope"), setLoading: capture("loading"),
    setListError: capture("listError"), setTargetsError: capture("targetsError"),
    setAnalyticsScope: capture("analyticsScope"), setAnalyticsID: capture("analyticsID"),
    setAnalytics: capture("analytics"), setAnalyticsLoading: capture("analyticsLoading"),
    setAnalyticsError: capture("analyticsError"), setFeedbackScope: capture("feedbackScope"),
    setDraftScope: capture("draftScope"), setFile: capture("file"),
    setMessage: capture("message"), setBusy: capture("busy"),
    setBusyScope: capture("busyScope"), setCaption: capture("caption"),
    setRights: capture("rights"), selectKind: capture("selectKind"),
    read: async () => { readCalls++; },
    Date, console: { error() {} }, Error,
  };
  return {
    token, list, targets, analytics, post, picker, events, fetchCalls, analyticsCalls, file,
    scopeKey, context, attempt, uploadBusyScope, activeScope, readRequest, analyticsRequest, uploadRequest,
    make: name => createCallback(name, context),
    switchSession: () => { currentSession = session("login-two"); },
    switchStore: () => { activeScope.current = JSON.stringify([sessionKey, "store-b"]); },
    signout: () => { currentSession = ""; },
    get readCalls() { return readCalls; },
    formFields,
  };
}

test("no DSH read after token resolves in a replacement Identity session", async () => {
  const h = fixture();
  const pending = h.make("read")();
  h.switchSession();
  h.token.resolve("old-token");
  await pending;
  assert.equal(h.fetchCalls.length, 0);
});

test("old Store's pending media and targets cannot update new Store", async () => {
  const h = fixture();
  const pending = h.make("read")();
  h.token.resolve("first-token");
  await flush();
  assert.equal(h.fetchCalls.length, 2);
  h.switchStore();
  h.list.resolve(mockResponse({ items: [{ id: "old-reel" }] }));
  h.targets.resolve(mockResponse({ targets: [{ targetType: "PRODUCT", targetId: "old", label: "Old" }] }));
  await pending;
  assert.equal(h.events.some(([kind, value]) => kind === "items" && value.length), false);
  assert.equal(h.events.some(([kind, value]) => kind === "readScope" && value), false);
});

test("valid owner session reads both media and destinations from the selected Store", async () => {
  const h = fixture();
  const pending = h.make("read")();
  h.token.resolve("first-token");
  await flush();
  assert.ok(h.fetchCalls.every(([url, options]) => url.includes("/stores/store-a/") && options.headers.Authorization === "Bearer first-token"));
  h.list.resolve(mockResponse({ items: [{ id: "content-1" }] }));
  h.targets.resolve(mockResponse({ targets: [{ targetType: "PRODUCT", targetId: "product-1", label: "اختبار" }] }));
  await pending;
  assert.ok(h.events.some(([kind, value]) => kind === "items" && value[0]?.id === "content-1"));
  assert.ok(h.events.some(([kind, value]) => kind === "targets" && value[0]?.targetId === "product-1"));
  assert.ok(h.events.some(([kind, value]) => kind === "readScope" && value === h.scopeKey));
});

test("partial DSH media failure preserves destination choices and retry feedback", async () => {
  const h = fixture();
  const pending = h.make("read")();
  h.token.resolve("token");
  await flush();
  h.list.resolve({ ok: false });
  h.targets.resolve(mockResponse({ targets: [{ targetType: "PRODUCT", targetId: "product-2", label: "سلة" }] }));
  await pending;
  assert.ok(h.events.some(([kind, value]) => kind === "items" && value.length === 0));
  assert.ok(h.events.some(([kind, value]) => kind === "targets" && value[0]?.targetId === "product-2"));
  assert.ok(h.events.some(([kind, value]) => kind === "listError" && String(value).includes("تعذر")));
});

test("old session cannot request private content analytics after delayed token", async () => {
  const h = fixture();
  const pending = h.make("loadAnalytics")("content-1");
  h.switchSession();
  h.token.resolve("old");
  await pending;
  assert.equal(h.analyticsCalls.length, 0);
});

test("late analytics response cannot render old session's counts", async () => {
  const h = fixture();
  const pending = h.make("loadAnalytics")("content-1");
  h.token.resolve("token");
  await flush();
  assert.equal(h.analyticsCalls.length, 1);
  assert.equal(h.analyticsCalls[0][1], "store-a");
  h.signout();
  h.analytics.resolve({ items: [{ eventType: "IMPRESSION", count: 44 }] });
  await pending;
  assert.equal(h.events.some(([kind, value]) => kind === "analytics" && value?.items?.length), false);
});

test("late native file selection after Store change is discarded", async () => {
  const h = fixture();
  const pending = h.make("choose")();
  h.switchStore();
  h.picker.resolve({ canceled: false, assets: [h.file] });
  await pending;
  assert.equal(h.events.some(([kind]) => kind === "file"), false);
});

test("valid MP4 file selection is scoped to current Identity and Store", async () => {
  const h = fixture();
  const pending = h.make("choose")();
  h.picker.resolve({ canceled: false, assets: [h.file] });
  await pending;
  assert.ok(h.events.some(([kind, value]) => kind === "file" && value.name === "video.mp4"));
  assert.ok(h.events.some(([kind, value]) => kind === "draftScope" && value === h.scopeKey));
});

test("same merchant relogin before token resolution blocks upload POST", async () => {
  const h = fixture();
  const pending = h.make("submit")();
  h.switchSession();
  h.token.resolve("stale");
  await pending;
  assert.equal(h.fetchCalls.length, 0);
});

test("successful rights-attested video upload uses DSH Store, stable keys and review", async () => {
  const h = fixture();
  const pending = h.make("submit")();
  h.token.resolve("partner-token");
  await flush();
  assert.equal(h.fetchCalls.length, 1);
  const [url, request] = h.fetchCalls[0];
  assert.ok(url.endsWith("/stores/store-a/discovery-content"));
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer partner-token");
  assert.ok(request.headers["Idempotency-Key"]);
  assert.ok(request.headers["X-Correlation-ID"]);
  const fields = Object.fromEntries(h.formFields[0]);
  assert.equal(fields.kind, "SHORT_FORM");
  assert.equal(fields.targetType, "STORE");
  assert.equal(fields.rightsAttested, "true");
  assert.ok(String(fields.rightsStatement).includes("حقوق"));
  assert.equal(fields.file.name, "video.mp4");
  h.post.resolve({ ok: true });
  await pending;
  assert.ok(h.events.some(([kind, value]) => kind === "message" && String(value).includes("للمراجعة")));
  assert.equal(h.readCalls, 1);
  assert.equal(h.attempt.current, null);
});

test("late POST from old Store cannot clear new draft or report upload success", async () => {
  const h = fixture();
  const pending = h.make("submit")();
  h.token.resolve("partner-token");
  await flush();
  h.switchStore();
  h.post.resolve({ ok: true });
  await pending;
  assert.equal(h.events.some(([kind, value]) => kind === "file" && value === null), false);
  assert.equal(h.events.some(([kind, value]) => kind === "message" && String(value).includes("للمراجعة")), false);
  assert.equal(h.readCalls, 0);
});

test("synchronous double click performs at most one upload in the same scope", async () => {
  const h = fixture();
  const submit = h.make("submit");
  const first = submit();
  const second = submit();
  h.token.resolve("partner-token");
  await flush();
  assert.equal(h.fetchCalls.length, 1);
  h.post.resolve({ ok: true });
  await Promise.all([first, second]);
  assert.equal(h.fetchCalls.length, 1);
});

test("retry after uncertain POST retains the original idempotency and content ID", async () => {
  const h = fixture();
  h.context.getUsableIdentityAccessToken = async () => "partner-token";
  const requests = [];
  h.context.fetch = (_url, req) => { requests.push(req); return Promise.resolve({ ok: requests.length !== 1 }); };
  const submit = h.make("submit");
  await submit();
  assert.equal(requests.length, 1);
  const first = h.attempt.current;
  assert.ok(first?.idempotencyKey);
  await submit();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  assert.equal(first.contentId, Object.fromEntries(h.formFields[1]).id);
  assert.equal(h.attempt.current, null);
});

test("Store/session effect resets media and cancels old async callbacks", () => {
  const h = fixture();
  h.readRequest.current = 2;
  h.analyticsRequest.current = 3;
  h.uploadRequest.current = 4;
  const context = {
    ...h.context,
    setTargetType() {}, setTargetId() {}, setTargetSearch() {},
    setFile() {}, setCaption() {}, setRights() {}, setDraftScope() {},
    setFeedbackScope() {}, setBusyScope() {}, setBusy() {}, setMessage() {},
    setItems() {}, setTargets() {}, setReadScope() {}, setAnalyticsID() {},
    setAnalytics() {}, setAnalyticsScope() {}, setListError() {},
    setTargetsError() {}, setLoading() {}, read: async () => {},
  };
  const cleanup = vm.runInNewContext(compile(scopeEffect), context)();
  cleanup();
  assert.equal(h.readRequest.current, 3);
  assert.equal(h.analyticsRequest.current, 5);
  assert.equal(h.uploadRequest.current, 5);
});

test("media UI gates lists, analytics, draft, feedback and uploads to session+Store", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /JSON\.stringify\(\[sessionKey, storeId\]\)/);
  assert.match(source, /readScope === scopeKey && scopeCurrent\(\) \? items : \[\]/);
  assert.match(source, /readScope === scopeKey && scopeCurrent\(\) \? targets : \[\]/);
  assert.match(source, /draftScope === scopeKey && scopeCurrent\(\) \? file : null/);
  assert.match(source, /feedbackScope === scopeKey && scopeCurrent\(\) \? message : ""/);
  assert.match(source, /analyticsScope === scopeKey && scopeCurrent\(\)/);
  assert.match(source, /uploadBusyScope\.current === scopeKey/);
  assert.match(source, /if \(!valid\(\)\) return;\s*if \(!response\.ok\)/);
  assert.match(source, /accessibilityLabel="فيديوهات المتجر"/);
  assert.match(source, /حقوق نشر هذا المحتوى/);
});
