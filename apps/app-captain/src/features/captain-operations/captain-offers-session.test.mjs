import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./captain-offers.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("captain-offers.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "captain", subject, sessionId },
});
const offer = (id, version = 1) => ({
  id,
  orderId: ["order-", id].join(""),
  version,
  state: "offered",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

function production(name, runtime) {
  let code = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const expression = node.initializer;
      code = ts.isCallExpression(expression) && expression.expression.getText(ast) === "useCallback"
        ? expression.arguments[0]?.getText(ast) ?? "" : expression.getText(ast);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(code, ["Missing production ", name].join(""));
  const sourceText = code.startsWith("async function") || code.startsWith("function")
    ? [code, "; ({", name, "})"].join("")
    : ["const ", name, " = ", code, "; ({", name, "})"].join("");
  const js = ts.transpileModule(sourceText, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return runInNewContext(js, runtime)[name];
}

const claimCaptainOfferResponse = production("claimCaptainOfferResponse", {});
const isCaptainOfferActionable = production("isCaptainOfferActionable", {});

function harness(extractLoad = true) {
  const state = {
    current: identity("captain-1", "session-1"),
    offers: [],
    loading: [],
    busy: [],
    errors: [],
    loadedKeys: [],
    requests: 0,
    mutations: [],
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    readSequence: { current: 0 },
    getUsableIdentityAccessToken: async () => "bearer-token",
    captainClient: () => ({
      listOwnCaptainOffers: async () => { state.requests++; return { offers: [offer("offer-1")] }; },
      respondToCaptainOffer: async (...args) => { state.mutations.push(args); },
    }),
    setLoading: value => state.loading.push(value),
    setOffers: value => state.offers.push(value),
    setLoadedSessionKey: value => state.loadedKeys.push(value),
    setError: value => state.errors.push(value),
    console: { error: () => {} },
  };
  return { state, runtime, load: extractLoad ? production("load", runtime) : undefined };
}

test("an offer response serializes mutations across all offers", () => {
  const inFlight = new Set();
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), true);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-1"), false);
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-2"), false);
  inFlight.delete("offer-1");
  assert.equal(claimCaptainOfferResponse(inFlight, "offer-2"), true);
});

test("expired, invalid or already accepted offers are not actionable", () => {
  const now = Date.parse("2026-11-01T01:00:00.000Z");
  const future = new Date(now + 1).toISOString();
  const expired = new Date(now - 1).toISOString();
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, now), true);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, now + 1), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: expired }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "accepted", expiresAt: future }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: "invalid" }, now), false);
  assert.equal(isCaptainOfferActionable({ state: "offered", expiresAt: future }, Number.NaN), false);
});

test("Captain offer list loads and binds to its exact authenticated session", async () => {
  const h = harness();
  assert.equal(await h.load(), true);
  assert.equal(h.state.requests, 1);
  assert.equal(h.state.loadedKeys.at(-1), captainSessionKey(h.state.current));
  assert.equal(h.state.offers.at(-1)[0].id, "offer-1");
  assert.equal(h.state.loading.at(-1), false);
});

test("a late offer response cannot show previous private offers after same-actor reauthentication", async () => {
  const h = harness();
  let resolveRead;
  const delayed = new Promise(resolve => { resolveRead = resolve; });
  h.runtime.captainClient = () => ({
    listOwnCaptainOffers: async () => { h.state.requests++; return delayed; },
  });
  const pending = h.load();
  for (let i = 0; i < 6 && !h.state.requests; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.requests, 1);
  h.state.current = identity("captain-1", "session-2");
  resolveRead({ offers: [offer("private-old")] });
  assert.equal(await pending, false);
  assert.equal(h.state.offers.some(items => items.some(item => item.id === "private-old")), false);
  assert.equal(h.state.loadedKeys.some(Boolean), false);
});

test("a token returned after session renewal cannot initiate the former offer read", async () => {
  const h = harness();
  let resolveToken;
  let started = false;
  const pendingToken = new Promise(resolve => { resolveToken = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return pendingToken; };
  const pending = h.load();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-1", "session-2");
  resolveToken("old-token");
  assert.equal(await pending, false);
  assert.equal(h.state.requests, 0);
});

test("Captain offer polling rejects a response from a replaced session", async () => {
  const h = harness();
  let release;
  let started = false;
  const pendingRead = new Promise(resolve => { release = resolve; });
  h.runtime.busy = "";
  h.runtime.cancelled = false;
  h.runtime.refreshInFlight = false;
  h.runtime.sessionKey = captainSessionKey(h.state.current);
  h.runtime.captainClient = () => ({
    listOwnCaptainOffers: async () => { started = true; return pendingRead; },
  });
  const refresh = production("refresh", h.runtime);
  const pending = refresh();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-1", "session-2");
  release({ offers: [offer("private-old")] });
  await pending;
  assert.equal(h.state.offers.length, 0);
});

function responseHarness() {
  const h = harness(false);
  const currentOffer = offer("offer-5", 9);
  h.runtime.loadedSessionKey = captainSessionKey(h.state.current);
  h.runtime.currentOffersSession = true;
  h.runtime.offers = [currentOffer];
  h.runtime.busy = "";
  h.runtime.loading = false;
  h.runtime.claimCaptainOfferResponse = claimCaptainOfferResponse;
  h.runtime.isCaptainOfferActionable = isCaptainOfferActionable;
  h.runtime.responseInFlight = { current: new Set() };
  h.runtime.setBusy = value => h.state.busy.push(value);
  h.runtime.load = async () => { h.state.requests++; return true; };
  return { ...h, offer: currentOffer, respond: production("respond", h.runtime) };
}

test("Captain offer response preserves canonical offer version and decision", async () => {
  const h = responseHarness();
  await h.respond(h.offer, "accept");
  assert.equal(h.state.mutations.length, 1);
  assert.equal(h.state.mutations[0][1], "offer-5");
  assert.equal(h.state.mutations[0][2].decision, "accept");
  assert.equal(h.state.mutations[0][3], 9);
  assert.equal(h.state.requests, 1);
  assert.equal(h.runtime.responseInFlight.current.size, 0);
});

test("a stale same-actor offer cannot be accepted from a replaced Identity session", async () => {
  const h = responseHarness();
  h.state.current = identity("captain-1", "session-2");
  await h.respond(h.offer, "accept");
  assert.equal(h.state.mutations.length, 0);
  assert.equal(h.state.requests, 0);
});

test("a Captain session switch while token is pending blocks mutation", async () => {
  const h = responseHarness();
  let releaseToken;
  let started = false;
  const pendingToken = new Promise(resolve => { releaseToken = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return pendingToken; };
  const pending = h.respond(h.offer, "reject");
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-1", "session-2");
  releaseToken("old-token");
  await pending;
  assert.equal(h.state.mutations.length, 0);
  assert.equal(h.state.requests, 0);
  assert.equal(h.runtime.responseInFlight.current.size, 0);
});

test("late mutation completion from former session never drives stale readback", async () => {
  const h = responseHarness();
  let releaseMutation;
  let started = false;
  const pendingMutation = new Promise(resolve => { releaseMutation = resolve; });
  h.runtime.captainClient = () => ({
    respondToCaptainOffer: async (...args) => { h.state.mutations.push(args); started = true; return pendingMutation; },
  });
  const pending = h.respond(h.offer, "accept");
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-1", "session-2");
  releaseMutation();
  await pending;
  assert.equal(h.state.requests, 0);
  assert.equal(h.state.errors.some(Boolean), false);
});

test("uncertain offer response never automatically retries the mutation", async () => {
  const h = responseHarness();
  h.runtime.captainClient = () => ({
    respondToCaptainOffer: async (...args) => {
      h.state.mutations.push(args);
      throw new Error("connection timeout after send");
    },
  });
  await h.respond(h.offer, "accept");
  assert.equal(h.state.mutations.length, 1);
  assert.equal(h.state.requests, 1, "readback once to determine server outcome");
  assert.match(h.state.errors.at(-1), /لم نتأكد من نتيجة الرد/);
});

test("Offers render, polling and action buttons require session-matched state", () => {
  assert.match(source, /const sessionKey = captainSessionKey\(identityState\)/);
  assert.match(source, /const currentOffersSession = Boolean\(sessionKey\) && loadedSessionKey === sessionKey/);
  assert.match(source, /captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
  assert.match(source, /const scopedOffers = currentOffersSession \? offers : \[\]/);
  assert.match(source, /useEffect\(\(\) => subscribeIdentitySession\(setIdentityState\), \[\]\)/);
  assert.match(source, /if \(!isFocused \|\| suppressed \|\| !currentOffersSession \|\| loading\) return/);
  assert.match(source, /!currentOffersSession \|\| !isCaptainOfferActionable\(offer\)/);
  assert.doesNotMatch(source, /isCurrentCaptainActor|loadedActorID|activeActorID/);
});
