import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/session/session-provider.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/(workspace)/layout.tsx", import.meta.url), "utf8");

// Run the actual SessionProvider callback bodies; remove only TypeScript assertions and
// the callback's type annotation. No mocked copy of the session transition logic.
const start = source.indexOf("  const restore = useCallback(");
const end = source.indexOf("  const value = useMemo", start);
assert.ok(start >= 0 && end > start, "SessionProvider lifecycle callbacks remain owned by Identity");
const runnable = source.slice(start, end)
  .replace(" as { error?: { code?: unknown } } | null", "")
  .replace(" as { identity?: ActorIdentity }", "")
  .replace("(identity: ActorIdentity)", "(identity)");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const actor = (subject, sessionId = "session-a") => ({
  subject, sessionId, role: "operator", permissions: ["finance"],
});

function response(status, identity) {
  return {
    status, ok: status >= 200 && status < 300,
    json: async () => ({ identity }),
    clone() { return this; },
  };
}

function provider(overrides = {}) {
  let state = { kind: "authenticated", identity: actor("old-operator") };
  let busy = false;
  const states = [state], busyEvents = [], requests = [];
  const epoch = { current: 0 };
  const context = {
    sessionEpoch: epoch,
    useCallback: (callback) => callback,
    useEffect: () => {}, // callback-only runtime; mount effects are not executed in this test
    setState: (next) => { state = next; states.push(next); },
    setBusy: (next) => { busy = next; busyEvents.push(next); },
    identityFetch: async (path, init) => {
      requests.push([path, init]);
      if (overrides.identityFetch) return overrides.identityFetch(path, init);
      return response(200, actor("old-operator"));
    },
    responseMessage: overrides.responseMessage ?? (async () => "response unavailable"),
  };
  const actions = runInNewContext(`${runnable}\n({restore,authenticate,logout});`, context);
  return { ...actions, states, busyEvents, requests, epoch,
    get state() { return state; }, get busy() { return busy; } };
}

test("the protected operator workspace mounts only for the currently admitted identity and session", () => {
  assert.match(layout, /<main key=\{workspaceScope\}/);
  assert.match(layout, /const workspaceScope = JSON\.stringify\(\[state\.identity\.subject, state\.identity\.sessionId,/);
  assert.match(source, /const sessionEpoch = useRef\(0\)/);
});

test("login immediately supersedes an in-flight session restore even for the same operator", async () => {
  const oldRead = deferred();
  const p = provider({ identityFetch: () => oldRead.promise });
  const restoring = p.restore();
  assert.equal(p.state.kind, "loading");
  p.authenticate(actor("new-operator"));
  oldRead.resolve(response(200, actor("old-operator")));
  await restoring;
  assert.equal(p.state.kind, "authenticated");
  assert.equal(p.state.identity.subject, "new-operator");
  assert.equal(p.busy, false);
  assert.equal(p.states.filter((state) => state.kind === "authenticated" && state.identity.subject === "old-operator").length, 1);
});

test("old session restore cannot overwrite a newly authenticated same-actor session", async () => {
  const oldRead = deferred();
  const p = provider({ identityFetch: () => oldRead.promise });
  const restoring = p.restore();
  p.authenticate(actor("old-operator", "session-new"));
  oldRead.resolve(response(200, actor("old-operator", "session-old")));
  await restoring;
  assert.equal(p.state.identity.sessionId, "session-new");
});

test("a second restore invalidates an older response and its busy cleanup", async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const p = provider({ identityFetch: () => ++calls === 1 ? first.promise : second.promise });
  const early = p.restore();
  const late = p.restore();
  first.resolve(response(200, actor("stale-operator")));
  await early;
  assert.equal(p.state.kind, "loading");
  assert.equal(p.busy, true);
  second.resolve(response(200, actor("current-operator")));
  await late;
  assert.equal(p.state.identity.subject, "current-operator");
  assert.equal(p.busy, false);
});

test("logout immediately hides privileged workspace before remote session revocation completes", async () => {
  const pendingLogout = deferred();
  const p = provider({ identityFetch: () => pendingLogout.promise });
  const signingOut = p.logout();
  assert.equal(p.state.kind, "loading");
  assert.equal(p.busy, true);
  pendingLogout.resolve(response(204));
  await signingOut;
  assert.equal(p.state.kind, "signed_out");
  assert.equal(p.busy, false);
});

test("a session restore completed after logout cannot reauthenticate the revoked operator", async () => {
  const pendingRestore = deferred(), pendingLogout = deferred();
  const p = provider({ identityFetch: (path) => path.includes("logout") ? pendingLogout.promise : pendingRestore.promise });
  const restoring = p.restore();
  const signingOut = p.logout();
  pendingRestore.resolve(response(200, actor("stale-operator")));
  await restoring;
  assert.equal(p.state.kind, "loading");
  pendingLogout.resolve(response(204));
  await signingOut;
  assert.equal(p.state.kind, "signed_out");
  assert.equal(p.busy, false);
});

test("an expired restore error or 409 conflict completed after a newer login cannot revoke the new UI", async () => {
  for (const errorKind of ["reject", "conflict"]) {
    const pending = deferred();
    const p = provider({ identityFetch: () => pending.promise });
    const restoring = p.restore();
    p.authenticate(actor("new-operator"));
    if (errorKind === "reject") pending.reject(new Error("network error"));
    else pending.resolve({ ...response(409), ok: false, json: async () => ({ error: { code: "CONFLICT" } }), clone() { return this; } });
    await restoring;
    assert.equal(p.state.identity.subject, "new-operator");
    assert.equal(p.busy, false);
  }
});

test("a delayed old logout response cannot sign out a later verified operator login", async () => {
  const pending = deferred();
  const p = provider({ identityFetch: () => pending.promise });
  const signingOut = p.logout();
  p.authenticate(actor("new-operator", "fresh-session"));
  pending.resolve(response(204));
  await signingOut;
  assert.equal(p.state.identity.subject, "new-operator");
  assert.equal(p.state.identity.sessionId, "fresh-session");
  assert.equal(p.busy, false);
});

test("a failed revocation never restores privileged workspace and reports unconfirmed server logout", async () => {
  const p = provider({ identityFetch: async () => response(500) });
  await p.logout();
  assert.equal(p.state.kind, "signed_out");
  assert.match(p.state.notice, /تعذر تأكيد إبطال الجلسة/);
  assert.equal(p.busy, false);
});

test("failed session read remains unavailable only for the active restore epoch", async () => {
  const p = provider({ identityFetch: async () => response(503) });
  await p.restore();
  assert.equal(p.state.kind, "unavailable");
  assert.equal(p.state.message, "response unavailable");
  assert.equal(p.busy, false);
});
