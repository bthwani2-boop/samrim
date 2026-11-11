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
  const state = { current: identity("captain-7", "session-1"), updates: [] };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    sessionKey: captainSessionKey(state.current),
    requestID: { current: 0 },
    setState: value => state.updates.push(value),
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({
      listOwnStoreCaptainMemberships: async () => ({ memberships: [{ id: "store-a", storeName: "متجر ألف", state: "active" }] }),
    }),
  };
  return { state, runtime, reload: production(membershipsSource, "reload", runtime) };
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
  assert.match(membershipsSource, /return \(\) => \{ requestID\.current\+\+; \}/);
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
