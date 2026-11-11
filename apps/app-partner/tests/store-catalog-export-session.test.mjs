import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/store-offer/store-catalog-export.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-catalog-export.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let exportFunction;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "exportCatalog") exportFunction = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(exportFunction, "extract the actual Store CSV export action from production source");
const compiled = ts.transpileModule(`${exportFunction}\nexportCatalog;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const session = id => partnerSetupSessionKey({
  kind: "authenticated", identity: { role: "partner", subject: "same-merchant", sessionId: id },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ os = "web" } = {}) {
  const token = deferred();
  const page = deferred();
  const sharingAvailable = deferred();
  const firstSession = session("login-1");
  const storeId = "store-a";
  let currentSession = firstSession;
  const scopeKey = JSON.stringify([firstSession, storeId]);
  const activeStoreId = { current: storeId };
  const activeRun = { current: 0 };
  const events = [];
  const requests = [];
  const downloads = [];
  const files = [];
  const shares = [];
  const capture = kind => value => events.push([kind, value]);
  const context = {
    storeId, storeName: "متجر الاختبار", sessionKey: firstSession, scopeKey,
    visibleBusy: false, activeStoreId, activeRun, STORE_CATALOG_EXPORT_PAGE_SIZE: 50,
    setFeedbackScope: capture("feedbackScope"), setBusy: capture("busy"),
    setError: capture("error"), setNotice: capture("notice"), setProgress: capture("progress"),
    currentPartnerSessionKey: () => currentSession,
    getUsableIdentityAccessToken: () => token.promise,
    client: () => ({
      readOwnStoreOffers: (...args) => { requests.push(args); return page.promise; },
    }),
    collectStoreCatalogCsv: async (requestedStore, getPage, onProgress) => {
      assert.equal(requestedStore, storeId);
      const response = await getPage("");
      onProgress(response.offers.length);
      return { count: response.offers.length, csv: "name,price\nitem,100\n" };
    },
    Platform: { OS: os },
    Blob: class MockBlob { constructor(parts) { this.parts = parts; } },
    URL: {
      createObjectURL: () => "blob:fake-export",
      revokeObjectURL: url => events.push(["revoke", url]),
    },
    document: {
      createElement: tag => {
        assert.equal(tag, "a");
        return { href: "", download: "", click() { downloads.push([this.href, this.download]); } };
      },
    },
    Sharing: {
      isAvailableAsync: () => sharingAvailable.promise,
      shareAsync: async (...args) => { shares.push(args); },
    },
    File: class MockFile {
      constructor(_cache, name) { this.uri = `file://${name}`; files.push(this); }
      create() { this.created = true; }
      write(contents) { this.contents = contents; }
    },
    Paths: { cache: "cache" },
    Crypto: { randomUUID: () => "test-uuid" },
    encodeURIComponent, Error, console: { warn: () => {} },
  };
  const exportCatalog = vm.runInNewContext(compiled, context);
  return {
    exportCatalog, token, page, sharingAvailable, events, requests, downloads, files, shares,
    scopeKey, activeRun, activeStoreId,
    switchSession: () => { currentSession = session("login-2"); },
    switchStore: () => { activeStoreId.current = "store-b"; },
    signout: () => { currentSession = ""; },
  };
}

test("same merchant new login cancels CSV before any DSH read after token resolution", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.switchSession();
  h.token.resolve("old-token");
  await pending;
  assert.equal(h.requests.length, 0);
  assert.equal(h.downloads.length, 0);
});

test("old session cannot download CSV when DSH page resolves after identity rotation", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  assert.equal(h.requests.length, 1);
  h.switchSession();
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await pending;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.events.some(([kind, value]) => kind === "notice" && value), false);
});

test("Store selection change prevents stale page CSV download", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.switchStore();
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await pending;
  assert.equal(h.downloads.length, 0);
});

test("current session and Store generate one complete CSV download and visible completion", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], "token-1");
  assert.equal(h.requests[0][1], "store-a");
  assert.equal(h.requests[0][2], 50);
  assert.equal(h.requests[0][3], "");
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await pending;
  assert.deepEqual(h.downloads, [["blob:fake-export", "bthwani-store-store-a-catalog.csv"]]);
  assert.ok(h.events.some(([kind, value]) => kind === "feedbackScope" && value === h.scopeKey));
  assert.ok(h.events.some(([kind, value]) => kind === "progress" && value === 1));
  assert.ok(h.events.some(([kind, value]) => kind === "notice" && String(value).includes("1 عرضًا")));
  assert.ok(h.events.some(([kind, value]) => kind === "revoke" && value === "blob:fake-export"));
});

test("overlapping clicks keep only the newest attempt active, including its completion state", async () => {
  const h = fixture();
  const first = h.exportCatalog();
  const second = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  assert.equal(h.requests.length, 1);
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await Promise.all([first, second]);
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.events.filter(([kind]) => kind === "busy").map(([, value]) => value), [true, true, false]);
});

test("native export does not write or share a private file after an async availability check changes session", async () => {
  const h = fixture({ os: "android" });
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await flush();
  h.switchSession();
  h.sharingAvailable.resolve(true);
  await pending;
  assert.equal(h.files.length, 0);
  assert.equal(h.shares.length, 0);
});

test("current Android session preserves native sharing of the complete CSV", async () => {
  const h = fixture({ os: "android" });
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await flush();
  h.sharingAvailable.resolve(true);
  await pending;
  assert.equal(h.files.length, 1);
  assert.equal(h.files[0].created, true);
  assert.equal(h.files[0].contents, "name,price\nitem,100\n");
  assert.equal(h.shares.length, 1);
  assert.equal(h.downloads.length, 0);
});

test("unmounted or signed-out run cannot open a stale CSV download", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.activeRun.current += 1;
  h.signout();
  h.page.resolve({ offers: [{ id: "offer-1", storeId: "store-a" }], nextCursor: "" });
  await pending;
  assert.equal(h.downloads.length, 0);
});

test("view exposes only current session/Store feedback and keeps import/export contracts", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /JSON\.stringify\(\[sessionKey, storeId\]\)/);
  assert.match(source, /activeRun\.current === run && currentPartnerSessionKey\(\) === sessionKey && activeStoreId\.current === storeId/);
  assert.match(source, /return \(\) => \{ activeRun\.current \+= 1; \};\s*\}, \[scopeKey\]\)/);
  assert.match(source, /statusCurrent && error/);
  assert.match(source, /statusCurrent && notice/);
  assert.match(source, /visibleBusy \|\| !sessionKey/);
  assert.match(source, /if \(!scopeCurrent\(\)\) throw new Error\("STORE_EXPORT_SESSION_CHANGED"\);\s*const api = client/);
  assert.match(source, /collectStoreCatalogCsv\(storeId/);
  assert.match(source, /STORE_CATALOG_EXPORT_PAGE_SIZE/);
  assert.match(source, /Sharing\.shareAsync/);
  assert.match(source, /anchor\.click\(\)/);
  assert.doesNotMatch(source, /actorId|currentIdentityState\(\)\.identity\.subject/);
});


test("an empty authorized Store export reports no offers without opening a file", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.page.resolve({ offers: [], nextCursor: "" });
  await pending;
  assert.equal(h.downloads.length, 0);
  assert.ok(h.events.some(([kind, value]) => kind === "notice" && String(value).includes("لا توجد عروض")));
});

test("network failure shows a recoverable error only in the current authorized session", async () => {
  const h = fixture();
  const pending = h.exportCatalog();
  h.token.resolve("token-1");
  await flush();
  h.page.reject(new Error("NETWORK_DOWN"));
  await pending;
  assert.ok(h.events.some(([kind, value]) => kind === "error" && String(value).includes("تعذر تجهيز ملف الكتالوج")));
  assert.equal(h.downloads.length, 0);
  assert.ok(h.events.some(([kind, value]) => kind === "busy" && value === false));
});
