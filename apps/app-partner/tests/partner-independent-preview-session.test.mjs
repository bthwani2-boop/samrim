import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

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
  assert.match(source, /if \(stillCurrent\(\)\) setBusy\(false\)/);
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
  const currentScope = { current: scope(identity("partner-a", "session-1")) };
  runInNewContext(handler, {
    subscribeIdentitySession: (callback) => { emit = callback; return () => {}; },
    partnerSetupSessionKey: scope, currentScope, generation,
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
    runInNewContext(effect, {
      useEffect: callback => callback(),
      store, generation,
      setPreview: value => { preview = value; },
      setFailedMedia: value => { failedMedia = value; },
      setError: value => { error = value; },
      setBusy: value => { busy = value; },
    });
    return { preview, failedMedia, error, busy, generation: generation.current };
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
  }
});
