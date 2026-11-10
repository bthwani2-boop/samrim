import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./captain-offers.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("captain-offers.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function realExpression(kind) {
  let expression = "";
  function visit(node) {
    if (kind === "load" && ts.isVariableDeclaration(node) && node.name.getText(ast) === "load") {
      if (ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0]?.getText(ast) ?? "";
    }
    if (kind === "effect" && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[1]?.getText(ast) === "[sessionKey, load, suppressed]") {
      expression = node.arguments[0]?.getText(ast) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `Missing current-session Captain offers ${kind} production callback`);
  return expression;
}

const loadExpr = realExpression("load");
const effectExpr = realExpression("effect");
function execute(sourceText, globals) {
  const js = ts.transpileModule(sourceText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(js, globals);
}

function setup() {
  const state = {
    current: { kind: "authenticated", identity: { role: "captain", subject: "captain-a", sessionId: "session-1" } },
    offers: ["previous"], loadedKey: "",
    loading: false, busy: "old-offer", error: "old error", dismissed: "old-offer",
    requests: 0,
  };
  state.loadedKey = captainSessionKey(state.current);
  const loadPromises = [];
  let releaseOld;
  const delayedOld = new Promise(resolve => { releaseOld = resolve; });
  const globals = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    sessionKey: captainSessionKey(state.current),
    readSequence: { current: 0 },
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({
      listOwnCaptainOffers: async () => {
        state.requests++;
        return state.requests === 1
          ? delayedOld : { offers: ["current-session-offer"] };
      },
    }),
    setOffers: value => { state.offers = value; },
    setLoadedSessionKey: value => { state.loadedKey = value; },
    setLoading: value => { state.loading = value; },
    setBusy: value => { state.busy = value; },
    setError: value => { state.error = value; },
    setDismissedOfferId: value => { state.dismissed = value; },
    console: { error: () => {} },
    suppressed: false,
  };
  const realLoad = execute(`(function () { const savedLoad = ${loadExpr}; return {load: savedLoad}; })()`, globals).load;
  globals.load = () => {
    const next = realLoad();
    loadPromises.push(next);
    return next;
  };
  const effect = () => execute(`(function () { const effect = ${effectExpr}; effect(); })()`, globals);
  return { state, globals, loadPromises, releaseOld, effect };
}

async function started(h) {
  for (let i = 0; i < 10 && !h.state.requests; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.requests, 1);
}

test("mission suppression invalidates pending offer read, same-actor renewal gets fresh scoped result", async () => {
  const h = setup();
  h.effect();
  await started(h);
  h.globals.suppressed = true;
  h.effect();
  assert.equal(h.globals.readSequence.current, 2);
  assert.deepEqual(Array.from(h.state.offers), []);
  assert.equal(h.state.loadedKey, "");
  assert.equal(h.state.busy, "");
  assert.equal(h.state.error, "");
  assert.equal(h.loadPromises.length, 1, "suppressed mode must not request offers");

  h.state.current = {
    kind: "authenticated",
    identity: { role: "captain", subject: "captain-a", sessionId: "session-2" },
  };
  h.globals.sessionKey = captainSessionKey(h.state.current);
  h.globals.suppressed = false;
  h.effect();
  await h.loadPromises[1];
  assert.deepEqual(Array.from(h.state.offers), ["current-session-offer"]);
  assert.equal(h.state.loadedKey, h.globals.sessionKey);
  assert.equal(h.state.dismissed, "");

  h.releaseOld({ offers: ["former-session-offer"] });
  await h.loadPromises[0];
  assert.deepEqual(Array.from(h.state.offers), ["current-session-offer"]);
  assert.equal(h.state.loadedKey, h.globals.sessionKey);
});

test("signed-out and suppressed Captain never retain private offers or start another request", () => {
  const h = setup();
  h.globals.suppressed = true;
  h.effect();
  assert.deepEqual(Array.from(h.state.offers), []);
  assert.equal(h.state.loadedKey, "");
  assert.equal(h.state.requests, 0);
  h.state.current = { kind: "signed_out", reason: "explicit_logout" };
  h.globals.sessionKey = captainSessionKey(h.state.current);
  h.globals.suppressed = false;
  h.effect();
  assert.deepEqual(Array.from(h.state.offers), []);
  assert.equal(h.state.requests, 0);
});
