import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-independent-store-preview.tsx"), "utf8");
const identity = (subject, sessionId) => ({ kind: "authenticated", identity: { role: "partner", subject, sessionId } });
const scope = (state) => state.kind === "authenticated" && state.identity?.role === "partner"
  ? JSON.stringify([state.identity.subject, state.identity.sessionId]) : "";

test("private independent preview discards a response after identity/session or generation changes", () => {
  const guard = source.match(/const stillCurrent = \(\) => requestGeneration === generation\.current &&\s+partnerSetupSessionKey\(currentIdentityState\(\)\) === startingScope;/)?.[0];
  assert.ok(guard, "an in-flight read must verify the Identity session and request generation");
  const started = identity("partner-a", "session-1");
  const check = (observed, generation = 4) => runInNewContext(guard + "\nstillCurrent()", {
    requestGeneration: 4, generation: { current: generation },
    startingScope: scope(started), currentIdentityState: () => observed, partnerSetupSessionKey: scope,
  });
  assert.equal(check(started), true);
  assert.equal(check(identity("partner-b", "session-1")), false);
  assert.equal(check(identity("partner-a", "session-2")), false);
  assert.equal(check({ kind: "signed_out" }), false);
  assert.equal(check(started, 5), false);
  assert.match(source, /setPreview\(previous => !stillCurrent\(\) \? previous/);
  assert.match(source, /if \(stillCurrent\(\)\) setError/);
  assert.match(source, /if \(stillCurrent\(\)\) \{\s+readInFlight\.current = false;\s+setBusy\(false\);/);
});

test("identity subscription invalidates in-memory owner preview even for the same Store ID", () => {
  const handler = source.match(/const unsubscribe = subscribeIdentitySession\(next => \{[\s\S]*?\n    \}\);/)?.[0];
  assert.ok(handler, "preview must react to identity changes while mounted");
  let emit;
  let preview = { name: "Private draft" };
  let error = "prior error";
  let busy = true;
  let failedMedia = new Set(["store-cover", "offer:old"]);
  const generation = { current: 2 };
  const readInFlight = { current: true };
  const currentScope = { current: scope(identity("partner-a", "session-1")) };
  runInNewContext(handler, {
    subscribeIdentitySession: (callback) => { emit = callback; return () => {}; },
    partnerSetupSessionKey: scope, currentScope, generation, readInFlight,
    setPreview: (value) => { preview = value; },
    setFailedMedia: (value) => { failedMedia = value; },
    setError: (value) => { error = value; },
    setBusy: (value) => { busy = value; },
  });
  emit(identity("partner-a", "session-1"));
  assert.equal(preview?.name, "Private draft");
  assert.equal(failedMedia.size, 2);
  assert.equal(generation.current, 2);
  emit(identity("partner-a", "session-2"));
  assert.equal(preview, null);
  assert.equal(failedMedia.size, 0, "private image state must be cleared on session switch");
  assert.equal(error, "");
  assert.equal(busy, false);
  assert.equal(generation.current, 3);
  assert.equal(readInFlight.current, false, "switch releases old read lock");
  preview = { name: "Another private draft" };
  failedMedia = new Set(["offer:another"]);
  emit(identity("partner-b", "session-2"));
  assert.equal(preview, null);
  assert.equal(failedMedia.size, 0);
  assert.equal(generation.current, 4);
});


test("owner access is revoked or Store relation changes clears private preview and media state", () => {
  const effect = source.match(/useEffect\(\(\) => \{\s+if \(store\.owned && store\.relationModel === "INDEPENDENT_STORE"\) return;[\s\S]*?\n  \}, \[store\.owned, store\.relationModel\]\);/)?.[0];
  assert.ok(effect, "Store scope changes must clear privileged read state");
  function simulate(store) {
    let preview = { storeId: "s", name: "Confidential draft" };
    let failedMedia = new Set(["offer:private"]);
    let error = "old";
    let busy = true;
    const generation = { current: 4 };
    const readInFlight = { current: true };
    runInNewContext(effect, {
      useEffect: callback => callback(),
      store, generation, readInFlight,
      setPreview: value => { preview = value; },
      setFailedMedia: value => { failedMedia = value; },
      setError: value => { error = value; },
      setBusy: value => { busy = value; },
    });
    return { preview, failedMedia, error, busy, readInFlight: readInFlight.current, generation: generation.current };
  }
  const kept = simulate({ owned: true, relationModel: "INDEPENDENT_STORE" });
  assert.equal(kept.preview?.name, "Confidential draft");
  assert.equal(kept.generation, 4);
  for (const store of [
    { owned: false, relationModel: "INDEPENDENT_STORE" },
    { owned: true, relationModel: "BTHWANI_PARTNER" },
  ]) {
    const revoked = simulate(store);
    assert.equal(revoked.preview, null);
    assert.equal(revoked.failedMedia.size, 0);
    assert.equal(revoked.busy, false);
    assert.equal(revoked.error, "");
    assert.equal(revoked.generation, 5);
    assert.equal(revoked.readInFlight, false);
  }
});


// Exercise the actual nested production readPage handler, not a reimplementation.
function previewReadHarness() {
  const ast = ts.createSourceFile("partner-independent-store-preview.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "readPage") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, "the private preview must have an owner read handler");
  const code = ts.transpileModule(declaration.getText(ast) + "; readPage;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let actor = identity("partner-a", "session-1");
  const pending = [];
  const history = { errors: [], busy: [], reads: [] };
  const context = {
    store: { id: "store-a", owned: true, relationModel: "INDEPENDENT_STORE" },
    generation: { current: 0 },
    readInFlight: { current: false },
    currentScope: { current: scope(actor) },
    busy: false,
    preview: null,
    setPreview: next => { context.preview = typeof next === "function" ? next(context.preview) : next; },
    setFailedMedia: () => {},
    setBusy: next => history.busy.push(next),
    setError: next => history.errors.push(next),
    currentIdentityState: () => actor,
    partnerSetupSessionKey: scope,
    readOwnIndependentStorePreview: (storeID, cursor) => {
      history.reads.push([storeID, cursor]);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    Error,
  };
  const readPage = runInNewContext(code, context);
  return { readPage, pending, history, context, switchActor: next => { actor = next; } };
}

const validOwnerPreview = () => ({
  storeId: "store-a", relationModel: "INDEPENDENT_STORE",
  previewOnly: true, checkoutEnabled: false, offers: [], nextCursor: "",
});

test("same-render double tap starts only one private owner GET and permits later manual refresh", async () => {
  const h = previewReadHarness();
  const first = h.readPage();
  const duplicate = h.readPage();
  assert.equal(h.history.reads.length, 1, "busy React state must not allow a duplicate GET before rerender");
  h.pending[0].resolve(validOwnerPreview());
  await Promise.all([first, duplicate]);
  assert.equal(h.context.preview?.storeId, "store-a");
  const refresh = h.readPage();
  assert.equal(h.history.reads.length, 2, "the ref must be released after owner readback");
  h.pending[1].resolve(validOwnerPreview());
  await refresh;
});

test("wrong Store and non-private publication flags never populate the owner preview", async () => {
  for (const wrong of [
    { storeId: "store-b" },
    { relationModel: "BTHWANI_PARTNER" },
    { previewOnly: false },
    { checkoutEnabled: true },
  ]) {
    const h = previewReadHarness();
    const result = h.readPage();
    h.pending[0].resolve({ ...validOwnerPreview(), ...wrong });
    await result;
    assert.equal(h.context.preview, null);
    assert.ok(h.history.errors.some(Boolean), "invalid owner response should surface an error");
    assert.equal(h.history.busy.at(-1), false);
  }
});


test("a late Actor A response cannot unlock or overwrite Actor B's in-flight preview", async () => {
  const h = previewReadHarness();
  const handler = source.match(/const unsubscribe = subscribeIdentitySession\(next => \{[\s\S]*?\n    \}\);/)?.[0];
  assert.ok(handler);
  let emit;
  runInNewContext(handler, {
    ...h.context,
    subscribeIdentitySession: callback => { emit = callback; return () => {}; },
  });
  const fromA = h.readPage();
  const actorB = identity("partner-b", "session-2");
  h.switchActor(actorB);
  emit(actorB);
  assert.equal(h.context.readInFlight.current, false, "A's request must no longer block B");
  const fromB = h.readPage();
  assert.equal(h.history.reads.length, 2);
  h.pending[0].resolve({ ...validOwnerPreview(), name: "private A" });
  await fromA;
  assert.equal(h.context.readInFlight.current, true, "late A finally must not release B's lock");
  assert.equal(h.context.preview, null, "old private A response must not populate B");
  await h.readPage();
  assert.equal(h.history.reads.length, 2, "B's duplicate read must stay suppressed");
  h.pending[1].resolve({ ...validOwnerPreview(), name: "private B" });
  await fromB;
  assert.equal(h.context.preview?.name, "private B");
  assert.equal(h.context.readInFlight.current, false);
});


test("a denied or failed preview GET releases the lock for an explicit retry", async () => {
  const h = previewReadHarness();
  const rejected = h.readPage();
  h.pending[0].reject({ kind: "http", status: 403, code: "FORBIDDEN" });
  await rejected;
  assert.equal(h.context.preview, null);
  assert.equal(h.context.readInFlight.current, false);
  assert.equal(h.history.busy.at(-1), false);
  assert.ok(h.history.errors.some(Boolean));
  const retry = h.readPage();
  assert.equal(h.history.reads.length, 2);
  h.pending[1].resolve(validOwnerPreview());
  await retry;
  assert.equal(h.context.preview?.storeId, "store-a");
});
