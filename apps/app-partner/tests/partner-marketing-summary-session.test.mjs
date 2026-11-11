import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-marketing-summary.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("partner-marketing-summary.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
assert.ok(callback, "real Partner Store marketing focus work must be testable");
const compiled = ts.transpileModule("const run = " + callback + ";\nrun;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const session = id => partnerSetupSessionKey({
  kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: id },
});
const defer = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ storeId = "store-a", period = "all" } = {}) {
  const token = defer();
  const reply = defer();
  const first = session("login-1");
  let current = first;
  let readCount = 0;
  const events = [];
  const scopeKey = JSON.stringify([first, storeId, period]);
  const context = {
    storeId, period, sessionKey: first, scopeKey, retry: 0,
    currentPartnerSessionKey: () => current,
    setSummary: value => events.push(["summary", value]),
    setLoadedScope: value => events.push(["scope", value]),
    setError: value => events.push(["error", value]),
    setLoading: value => events.push(["loading", value]),
    getUsableIdentityAccessToken: () => token.promise,
    createPartnerDshClient: () => ({
      readPartnerStoreContentPerformanceSummary: (...args) => {
        readCount++;
        assert.equal(args[1], storeId);
        assert.equal(args[2], period);
        return reply.promise;
      },
    }),
    verifiedStoreContentPerformance: (result, expectedStoreId, expectedPeriod) =>
      result.storeId === expectedStoreId && result.period === expectedPeriod ? result : null,
    Crypto: { randomUUID: () => "test-id" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://local.invalid" } },
    Error,
  };
  const run = vm.runInNewContext(compiled, context);
  const cleanup = run();
  return { token, reply, events, cleanup, scopeKey,
    replaceSession: () => { current = session("login-2"); },
    signout: () => { current = ""; },
    get readCount() { return readCount; },
  };
}

test("same-actor session replacement blocks request after old token acquisition", async () => {
  const h = fixture();
  h.replaceSession();
  h.token.resolve("old-token");
  await flush();
  assert.equal(h.readCount, 0);
  assert.equal(h.events.some(([type, value]) => type === "summary" && value !== null), false);
});

test("late DSH marketing results cannot expose Store counts after same-actor relogin", async () => {
  const h = fixture({ storeId: "store-a", period: "7d" });
  h.token.resolve("token-1");
  await flush();
  assert.equal(h.readCount, 1);
  h.replaceSession();
  h.reply.resolve({ storeId: "store-a", period: "7d", contentCount: 50 });
  await flush();
  assert.equal(h.events.some(([type, value]) => type === "summary" && value?.contentCount), false);
  assert.equal(h.events.some(([type, value]) => type === "scope" && value === h.scopeKey), false);
});

test("same-session matching Store and period can publish content summary", async () => {
  const h = fixture({ storeId: "store-a", period: "30d" });
  h.token.resolve("token-1");
  await flush();
  h.reply.resolve({ storeId: "store-a", period: "30d", contentCount: 14 });
  await flush();
  assert.ok(h.events.some(([type, value]) => type === "summary" && value?.contentCount === 14));
  assert.ok(h.events.some(([type, value]) => type === "scope" && value === h.scopeKey));
  assert.ok(h.events.some(([type, value]) => type === "loading" && value === false));
});

test("wrong-Store marketing response fails existing verification and cannot display counts", async () => {
  const h = fixture();
  h.token.resolve("token-1");
  await flush();
  h.reply.resolve({ storeId: "store-other", period: "all", contentCount: 99 });
  await flush();
  assert.equal(h.events.some(([type, value]) => type === "summary" && value?.contentCount), false);
  assert.ok(h.events.some(([type, value]) => type === "error" && value.includes("تعذرت")));
});

test("signed-out session discards in-flight content summary", async () => {
  const h = fixture();
  h.token.resolve("token-1");
  await flush();
  h.signout();
  h.reply.resolve({ storeId: "store-a", period: "all", contentCount: 1 });
  await flush();
  assert.equal(h.events.some(([type, value]) => type === "scope" && value === h.scopeKey), false);
});

test("live render and actions use exact session, Store, period and retain UX recovery", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /JSON\.stringify\(\[sessionKey, storeId, period\]\)/);
  assert.match(source, /currentPartnerSessionKey\(\) === sessionKey && loadedScope === scopeKey/);
  assert.match(source, /if \(!valid\(\)\) return;\s*const api/);
  assert.match(source, /if \(!valid\(\)\) return;\s*const verified/);
  assert.match(source, /verifiedStoreContentPerformance\(result, storeId, period\)/);
  assert.doesNotMatch(source, /activeActor|identityState\.identity\.subject === actorId/);
  for (const copy of ["7 أيام", "30 يومًا", "كل الفترات", "نقرات لكل 100 ظهور", "إعادة قراءة تحليلات المقاطع"]) {
    assert.ok(source.includes(copy));
  }
  assert.match(source, /storeContentEventRatios\(visibleSummary\)/);
});
