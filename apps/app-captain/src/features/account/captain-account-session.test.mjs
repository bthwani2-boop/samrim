import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";
import { preferredCaptainProfileMembership } from "../captain-operations/captain-store-membership-policy.ts";

const accountSource = readFileSync(new URL("./account.tsx", import.meta.url), "utf8");
const membershipsSource = readFileSync(new URL("../captain-operations/store-memberships.tsx", import.meta.url), "utf8");
const identity = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "captain", subject, sessionId },
});

function production(source, name, runtime) {
  const ast = ts.createSourceFile("captain-session-source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      callback = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]?.getText(ast) ?? ""
        : node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, `Production callback not found: ${name}`);
  const js = ts.transpileModule(
    `const ${name} = ${callback}; ({${name}})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(js, runtime)[name];
}

function accountHarness() {
  const state = { current: identity("captain-7", "session-1"), reads: [], failures: [] };
  const runtime = {
    cancelled: false,
    currentIdentityState: () => state.current,
    captainSessionKey,
    sessionKey: captainSessionKey(state.current),
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({
      readOwnCaptainAdmission: async () => ({ admission: { fullNameAr: "كابتن جديد", state: "eligible" } }),
      listOwnStoreCaptainMemberships: async () => ({ memberships: [] }),
    }),
    setProfileRead: value => state.reads.push(value),
    preferredCaptainProfileMembership,
    console: { error: reason => state.failures.push(reason) },
  };
  runtime.isCurrent = production(accountSource, "isCurrent", runtime);
  return { state, runtime, loadProfile: production(accountSource, "loadProfile", runtime) };
}

function membershipHarness() {
  const state = {
    current: identity("captain-7", "session-1"),
    updates: [], notices: [], accepting: [], reloadBarriers: [], acceptCalls: 0, listCalls: 0,
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    sessionKey: captainSessionKey(state.current),
    requestID: { current: 0 },
    mutationInFlight: { current: null },
    focused: { current: false },
    acceptingID: "",
    requiresReload: false,
    state: { kind: "ready", sessionKey: captainSessionKey(state.current),
      memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "pending" }] },
    setState: value => { state.updates.push(value); runtime.state = value; },
    setNotice: value => state.notices.push(value),
    setAcceptingID: value => { state.accepting.push(value); runtime.acceptingID = value; },
    setRequiresReload: value => { state.reloadBarriers.push(value); runtime.requiresReload = value; },
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({
      listOwnStoreCaptainMemberships: async () => {
        state.listCalls++;
        return { memberships: [{ id: "store-a", storeName: "متجر ألف", state: "active" }] };
      },
      acceptTargetedStoreCaptainInvitation: async () => { state.acceptCalls++; },
    }),
  };
  runtime.reload = production(membershipsSource, "reload", runtime);
  runtime.accept = production(membershipsSource, "acceptMembership", runtime);
  return { state, runtime, reload: runtime.reload, accept: runtime.accept };
}

test("account's canonical guard rejects the same Captain with a renewed session", () => {
  const h = accountHarness();
  assert.equal(h.runtime.isCurrent(), true);
  h.state.current = identity("captain-7", "session-2");
  assert.equal(h.runtime.isCurrent(), false);
  h.state.current = { kind: "unauthenticated" };
  assert.equal(h.runtime.isCurrent(), false);
});

test("a late admission response cannot display the former session's private profile", async () => {
  const h = accountHarness();
  let release;
  const pendingAdmission = new Promise(resolve => { release = resolve; });
  let started = false;
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { started = true; return pendingAdmission; },
  });
  const pending = h.loadProfile();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ admission: { fullNameAr: "ملف الجلسة القديمة", state: "eligible" } });
  await pending;
  assert.equal(h.state.reads.length, 0);
});

test("current Captain admission is shown under its exact session key", async () => {
  const h = accountHarness();
  await h.loadProfile();
  assert.equal(h.state.reads.length, 1);
  assert.equal(h.state.reads[0].sessionKey, captainSessionKey(h.state.current));
  assert.equal(h.state.reads[0].status, "ready");
  assert.equal(h.state.reads[0].profile.fullNameAr, "كابتن جديد");
});

test("Store-owned Captain profile fallback remains functional and session-scoped", async () => {
  const h = accountHarness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("NO_PUBLIC_ADMISSION"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "store-a", state: "active", displayNameAr: "كابتن متجر" }],
    }),
  });
  await h.loadProfile();
  assert.equal(h.state.reads.length, 1);
  assert.equal(h.state.reads[0].profile.fullNameAr, "كابتن متجر");
  assert.equal(h.state.reads[0].profile.state, "store_only");
  assert.equal(h.state.failures.length, 0);
});

test("Store Captain active membership without a display name still shows the true DSH state", async () => {
  const h = accountHarness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("NO_GENERAL_DISPATCH_ADMISSION"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "store-a", state: "active", displayNameAr: null }],
    }),
  });
  await h.loadProfile();
  assert.equal(h.state.reads.length, 1);
  assert.equal(h.state.reads[0].profile.fullNameAr, null);
  assert.equal(h.state.reads[0].profile.state, "store_only");
  assert.equal(h.state.failures.length, 0);
});

test("failed public admission cannot load a store profile into a renewed session", async () => {
  const h = accountHarness();
  let release;
  const delayedStoreMemberships = new Promise(resolve => { release = resolve; });
  let started = false;
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("NO_PUBLIC_ADMISSION"); },
    listOwnStoreCaptainMemberships: async () => { started = true; return delayedStoreMemberships; },
  });
  const pending = h.loadProfile();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ memberships: [{ id: "store-a", state: "active", displayNameAr: "قديم" }] });
  await pending;
  assert.equal(h.state.reads.length, 0);
  assert.equal(h.state.failures.length, 0);
});

test("Store invitation acceptance uses existing DSH mutation and owner readback", async () => {
  const h = membershipHarness();
  const calls = [];
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async (token, membershipID) => {
      calls.push(["accept", token, membershipID]);
      return { membership: { id: membershipID, state: "active" }, idempotentReplay: false };
    },
    listOwnStoreCaptainMemberships: async token => {
      calls.push(["readback", token]);
      return { memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "active" }] };
    },
  });
  await h.accept("invite-a");
  assert.deepEqual(calls, [["accept", "token", "invite-a"], ["readback", "token"]]);
  assert.equal(h.runtime.state.kind, "ready");
  assert.equal(h.runtime.state.memberships[0].state, "active");
  assert.match(h.state.notices.at(-1), /تم قبول دعوة المتجر/);
  assert.equal(h.runtime.mutationInFlight.current, null);
});

test("Store invitation cannot be accepted if it is not pending in the current session", async () => {
  const h = membershipHarness();
  await h.accept("not-my-invitation");
  assert.equal(h.state.acceptCalls, 0);
  h.runtime.state = { kind: "ready", sessionKey: h.runtime.sessionKey,
    memberships: [{ id: "invite-a", state: "active" }] };
  await h.accept("invite-a");
  assert.equal(h.state.acceptCalls, 0);
  h.runtime.state = { kind: "ready", sessionKey: "old-session",
    memberships: [{ id: "invite-a", state: "pending" }] };
  await h.accept("invite-a");
  assert.equal(h.state.acceptCalls, 0);
});

test("timed-out invitation acceptance reconciles a successful DSH commit", async () => {
  const h = membershipHarness();
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => { throw new Error("response lost"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "active" }],
    }),
  });
  await h.accept("invite-a");
  assert.equal(h.runtime.state.memberships[0].state, "active");
  assert.equal(h.runtime.requiresReload, false);
  assert.match(h.state.notices.at(-1), /تم قبول دعوة المتجر/);
});

test("unknown invitation mutation result cannot display success without canonical active readback", async () => {
  const h = membershipHarness();
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => { throw new Error("timeout"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "pending" }],
    }),
  });
  await h.accept("invite-a");
  assert.equal(h.runtime.state.memberships[0].state, "pending");
  assert.equal(h.runtime.requiresReload, true, "an ambiguous pending readback must require explicit refresh before retry");
  assert.match(h.state.notices.at(-1), /لم يُؤكَّد قبول الدعوة/);
  assert.doesNotMatch(h.state.notices.at(-1), /^تم قبول/);
});

test("unconfirmed invitation readback blocks a second mutation until a successful reload", async () => {
  const h = membershipHarness();
  let accepts = 0;
  let readFails = true;
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => { accepts++; },
    listOwnStoreCaptainMemberships: async () => {
      if (readFails) throw new Error("DSH is temporarily unavailable");
      return { memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "active" }] };
    },
  });
  await h.accept("invite-a");
  assert.equal(h.runtime.requiresReload, true);
  assert.equal(accepts, 1);
  await h.accept("invite-a");
  assert.equal(accepts, 1, "a missing readback cannot create another acceptance key");
  readFails = false;
  await h.reload();
  assert.equal(h.runtime.requiresReload, false);
  assert.equal(h.runtime.state.memberships[0].state, "active");
});

test("Store membership refresh cannot supersede an in-flight invitation readback", async () => {
  const h = membershipHarness();
  let release;
  let started = false;
  let listReads = 0;
  const pending = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => {
      started = true;
      return pending;
    },
    listOwnStoreCaptainMemberships: async () => {
      listReads++;
      return { memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "active" }] };
    },
  });
  const accepting = h.accept("invite-a");
  for (let i = 0; i < 8 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  assert.equal(h.runtime.mutationInFlight.current.sessionKey, h.runtime.sessionKey);
  await h.reload();
  assert.equal(listReads, 0, "a same-session focus refresh cannot invalidate the acceptance readback");
  release();
  await accepting;
  assert.equal(listReads, 1);
  assert.equal(h.runtime.state.memberships[0].state, "active");
  assert.match(h.state.notices.at(-1), /تم قبول دعوة المتجر/);
  assert.equal(h.runtime.mutationInFlight.current, null);
});

test("refocus during a pending Store invitation eventually reloads canonical DSH membership", async () => {
  const h = membershipHarness();
  let release;
  let mutationStarted = false;
  let reads = 0;
  const pendingMutation = new Promise(resolve => { release = resolve; });
  h.runtime.focused.current = true;
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => {
      mutationStarted = true;
      return pendingMutation;
    },
    listOwnStoreCaptainMemberships: async () => {
      reads++;
      return { memberships: [{ id: "invite-a", storeName: "متجر ألف", state: "active" }] };
    },
  });
  const acceptance = h.accept("invite-a");
  for (let i = 0; i < 8 && !mutationStarted; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(mutationStarted, true);
  // Expo keeps the tab mounted: blur invalidates old readbacks, then focus
  // tries to refresh while the previous acceptance still owns the lock.
  h.runtime.focused.current = false;
  h.runtime.requestID.current++;
  h.runtime.focused.current = true;
  await h.reload();
  assert.equal(reads, 0, "focus cannot overtake the mutation's canonical readback");
  release();
  await acceptance;
  for (let i = 0; i < 8 && reads === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1, "the latest focused session must reload when the mutation settles");
  assert.equal(h.runtime.state.kind, "ready");
  assert.equal(h.runtime.state.memberships[0].state, "active");
});

test("Captain session renewal while invitation token is pending never sends a DSH accept", async () => {
  const h = membershipHarness();
  let release;
  let tokenRequested = false;
  const tokenPending = new Promise(resolve => { release = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => {
    tokenRequested = true; return tokenPending;
  };
  const pending = h.accept("invite-a");
  for (let i = 0; i < 8 && !tokenRequested; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(tokenRequested, true);
  h.state.current = identity("captain-7", "session-2");
  release("former-token");
  await pending;
  assert.equal(h.state.acceptCalls, 0);
  assert.equal(h.state.listCalls, 0);
  assert.equal(h.state.updates.length, 0);
  assert.equal(h.state.notices.some(Boolean), false);
});

test("Captain Identity renewal during invitation mutation prevents old private readback", async () => {
  const h = membershipHarness();
  let release;
  let started = false;
  const pendingMutation = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    acceptTargetedStoreCaptainInvitation: async () => {
      h.state.acceptCalls++; started = true; return pendingMutation;
    },
    listOwnStoreCaptainMemberships: async () => {
      h.state.listCalls++; return { memberships: [{ id: "invite-a", state: "active" }] };
    },
  });
  const first = h.accept("invite-a");
  for (let i = 0; i < 8 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  await h.accept("invite-a");
  assert.equal(h.state.acceptCalls, 1, "same-device double press cannot send another acceptance");
  h.state.current = identity("captain-7", "session-2");
  release();
  await first;
  assert.equal(h.state.listCalls, 0);
  assert.equal(h.state.updates.length, 0);
  assert.equal(h.state.notices.some(Boolean), false);
  assert.equal(h.runtime.mutationInFlight.current, null);
});

test("Store membership reload rejects a stale same-actor session response", async () => {
  const h = membershipHarness();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let started = false;
  h.runtime.captainClient = () => ({
    listOwnStoreCaptainMemberships: async () => { started = true; return delayed; },
  });
  const pending = h.reload();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ memberships: [{ id: "private-old", storeName: "قديم", state: "active" }] });
  await pending;
  assert.equal(h.state.updates.length, 1);
  assert.equal(h.state.updates[0].kind, "loading");
  assert.equal(h.state.updates.some(value => value.kind === "ready"), false);
});

test("Store membership reload displays only the current session's memberships", async () => {
  const h = membershipHarness();
  await h.reload();
  assert.equal(h.state.updates.length, 2);
  assert.equal(h.state.updates[1].kind, "ready");
  assert.equal(h.state.updates[1].sessionKey, captainSessionKey(h.state.current));
  assert.equal(h.state.updates[1].memberships[0].storeName, "متجر ألف");
});

test("a superseded membership refresh cannot override the latest read", async () => {
  const h = membershipHarness();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({ listOwnStoreCaptainMemberships: () => delayed });
  const previous = h.reload();
  await new Promise(resolve => setImmediate(resolve));
  h.runtime.captainClient = () => ({ listOwnStoreCaptainMemberships: async () => ({ memberships: [{ id: "latest", state: "active" }] }) });
  await h.reload();
  release({ memberships: [{ id: "older", state: "active" }] });
  await previous;
  assert.equal(h.state.updates.filter(value => value.kind === "ready").length, 1);
  assert.equal(h.state.updates.at(-1).memberships[0].id, "latest");
});

test("visible Captain profile and membership values are keyed before rendering", () => {
  assert.match(accountSource, /const sessionKey = captainSessionKey\(identityState\)/);
  assert.match(accountSource, /profileRead\.sessionKey === sessionKey/);
  assert.match(accountSource, /captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
  assert.match(accountSource, /useEffect\(\(\) => subscribeIdentitySession\(setIdentityState\), \[\]\)/);
  assert.match(membershipsSource, /state\.sessionKey === sessionKey/);
  assert.match(membershipsSource, /currentSession === sessionKey/);
  assert.match(membershipsSource, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.match(membershipsSource, /return \(\) => \{ focused\.current = false; requestID\.current\+\+; \}/);
});

test("a token returned after Captain session replacement never starts the former profile read", async () => {
  const h = accountHarness();
  let release;
  const tokenPending = new Promise(resolve => { release = resolve; });
  let started = false;
  let apiCalls = 0;
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return tokenPending; };
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { apiCalls++; return { admission: { state: "eligible" } }; },
  });
  const pending = h.loadProfile();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release("old-token");
  await pending;
  assert.equal(apiCalls, 0);
  assert.equal(h.state.reads.length, 0);
});

test("current Captain sees the existing recoverable error if both profile readbacks fail", async () => {
  const h = accountHarness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("admission unavailable"); },
    listOwnStoreCaptainMemberships: async () => { throw new Error("memberships unavailable"); },
  });
  await h.loadProfile();
  assert.equal(h.state.reads.length, 1);
  assert.equal(h.state.reads[0].status, "error");
  assert.equal(h.state.reads[0].sessionKey, captainSessionKey(h.state.current));
  assert.equal(h.state.failures.length, 1);
});

test("current Captain sees Store membership recovery when the read fails", async () => {
  const h = membershipHarness();
  h.runtime.captainClient = () => ({
    listOwnStoreCaptainMemberships: async () => { throw new Error("temporary outage"); },
  });
  await h.reload();
  assert.equal(h.state.updates.length, 2);
  assert.equal(h.state.updates[0].kind, "loading");
  assert.equal(h.state.updates[1].kind, "error");
  assert.equal(h.state.updates[1].sessionKey, captainSessionKey(h.state.current));
});
