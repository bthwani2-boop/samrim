import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/account/partner-payout-card.tsx", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/features/wallet/wallet.tsx", import.meta.url), "utf8");
// Execute the actual async operation bodies, removing only TypeScript's
// local type annotations/non-null assertions (the repository uses TS 7 native tsc).
const runnableSource = source
  .replaceAll("selectedSummary!.", "selectedSummary.")
  .replaceAll("pendingAttempt!.", "pendingAttempt.")
  .replace("const review: LegacyAttempt =", "const review =");

function operation(name, next) {
  const begin = runnableSource.indexOf(`const ${name} = async () => {`);
  const end = runnableSource.indexOf(`const ${next}`, begin);
  assert.ok(begin >= 0 && end > begin, `actual ${name} operation can be isolated`);
  const snippet = runnableSource.slice(begin, end).trim();
  assert.match(snippet, /};$/);
  return (context) => runInNewContext(`${snippet}\n${name};`, context);
}

const request = operation("request", "recover =");
const recover = operation("recover", "requestIntake =");
const requestIntake = operation("requestIntake", "storeNames =");

const deferred = () => {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
};
const attempt = Object.freeze({
  walletOwnerActorId: "owner-a",
  idempotencyKey: "payout-original-key",
  correlationID: "payout-correlation",
  body: { scopeMode: "FULL_AVAILABLE", storeIds: ["store-a"] },
});
const summary = Object.freeze({
  attributionComplete: true, eligibleAvailableMinor: 900, currency: "YER",
  stores: [{ storeId: "store-a", storeName: "A", partnerActorId: "owner-a", eligibleAvailableMinor: 900 }],
});
const requestView = {
  totalAmountMinor: 900, currency: "YER", payouts: [{ id: "payout-1" }], stores: [],
};

function runtime(overrides = {}) {
  let active = true;
  const writes = [];
  const calls = [];
  const write = (name) => (...args) => { writes.push([name, ...args]); };
  const memory = new Map();
  const storage = {
    setItemAsync: async (key, value) => { memory.set(key, value); },
    deleteItemAsync: async (key) => { memory.delete(key); calls.push(["delete", key]); },
  };
  const api = {
    createPartnerPayoutRequest: async () => { calls.push(["createPayout"]); return { request: requestView }; },
    readPartnerPayoutRequestByKey: async () => { calls.push(["canonicalRead"]); return { request: requestView }; },
    createPartnerSettlementIntake: async () => {
      calls.push(["createIntake"]); return { intake: { status: "REQUESTED", resolvedAmountMinor: 900 } };
    },
  };
  const context = {
    stillCurrent: () => active,
    subject: "actor-a",
    selected: ["store-a"], selectedSummary: summary,
    state: summary, mode: "FULL_AVAILABLE", storeAmounts: {},
    pendingAttempt: attempt, pendingIntake: null, legacyPending: null, legacyKey: null,
    Crypto: { randomUUID: () => "uuid" },
    SecureStore: storage,
    storageKey: (subject) => `payout:${subject}`,
    intakeStorageKey: (subject) => `intake:${subject}`,
    getUsableIdentityAccessToken: async () => "original-session-token",
    client: () => api,
    isDefinitiveDshMobileClientRejection: () => false,
    isRecoverablePartnerPayout: () => true,
    matchesPartnerPayoutReadback: () => true,
    formatMoney: (value) => String(value),
    toAsciiDigits: (value) => value,
    console: { error: () => {} },
    load: async () => { calls.push(["load"]); },
    setBusy: write("busy"), setError: write("error"), setNotice: write("notice"),
    setPendingAttempt: write("pendingAttempt"), setLegacyPending: write("legacyPending"),
    setLegacyKey: write("legacyKey"), setLastRequest: write("lastRequest"),
    setStoreAmounts: write("storeAmounts"), setIntake: write("intake"),
    setPendingIntake: write("pendingIntake"), setMode: write("mode"),
    setSelected: write("selected"),
    ...overrides,
  };
  return { context, writes, calls, storage, api, memory,
    switchSession: () => { active = false; } };
}

test("payout card is remounted by full actor+session identity and has fail-closed render guard", () => {
  const first = partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "actor-a", sessionId: "s1" } });
  const renewed = partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "actor-a", sessionId: "s2" } });
  const another = partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "actor-b", sessionId: "s1" } });
  assert.notEqual(first, renewed);
  assert.notEqual(first, another);
  assert.match(wallet, /<PartnerPayoutCard key=\{`payout:\$\{sessionKey\}:\$\{payoutScopeKey\}`\}/);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/);
  assert.match(source, /if \(!stillCurrent\(\)\) return null;/);
  assert.match(source, /const storageKey = \(subject: string\)/);
  assert.match(source, /const intakeStorageKey = \(subject: string\)/);
  assert.match(source, /epoch === loadEpoch\.current/);
  assert.match(source, /const current = \(\) => stillCurrent\(\)/);
  assert.match(source, /return \(\) => \{ loadEpoch\.current \+= 1; \}/);
});

test("payout: renewed session before a token resolves never submits the old request", async () => {
  const token = deferred();
  const r = runtime({ getUsableIdentityAccessToken: () => token.promise });
  const pending = request(r.context)();
  r.switchSession();
  token.resolve("new-session-token");
  await pending;
  assert.deepEqual(r.calls, []);
  assert.equal(r.writes.some(([type, value]) => type === "notice" && Boolean(value)), false);
});

test("payout: logout while persisting a new attempt preserves original actor idempotency key without POST", async () => {
  const save = deferred();
  const r = runtime({ pendingAttempt: null,
    SecureStore: {
      setItemAsync: async (key, value) => { r.memory.set(key, value); await save.promise; },
      deleteItemAsync: async () => { throw new Error("must not delete"); },
    },
  });
  const pending = request(r.context)();
  assert.ok(r.memory.has("payout:actor-a"));
  r.switchSession();
  save.resolve();
  await pending;
  assert.deepEqual(r.calls, []);
  assert.equal(JSON.parse(r.memory.get("payout:actor-a")).idempotencyKey, "partner_payout_uuid");
  assert.equal(r.memory.has("payout:actor-b"), false);
});

test("payout: session switch during POST does not chain to canonical readback or display success", async () => {
  const started = deferred(), sent = deferred();
  const r = runtime({ client: () => ({ createPartnerPayoutRequest: async () => {
    r.calls.push(["createPayout"]); started.resolve(); return sent.promise;
  }, readPartnerPayoutRequestByKey: async () => { r.calls.push(["canonicalRead"]); return { request: requestView }; } }) });
  const pending = request(r.context)();
  await started.promise;
  r.switchSession();
  sent.resolve({ request: requestView });
  await pending;
  assert.deepEqual(r.calls, [["createPayout"]]);
  assert.equal(r.writes.some(([type]) => type === "lastRequest"), false);
  assert.equal(r.writes.some(([type, msg]) => type === "notice" && msg), false);
});

test("payout: session switch during canonical financial readback cannot erase pending attempt", async () => {
  const started = deferred(), returned = deferred();
  const r = runtime({ client: () => ({
    createPartnerPayoutRequest: async () => ({ request: requestView }),
    readPartnerPayoutRequestByKey: () => { started.resolve(); return returned.promise; },
  }) });
  const pending = request(r.context)();
  await started.promise;
  r.switchSession();
  returned.resolve({ request: requestView });
  await pending;
  assert.equal(r.calls.some(([name]) => name === "delete"), false);
  assert.equal(r.writes.some(([name]) => name === "lastRequest"), false);
});

test("payout: confirmed original-session canonical readback clears only the original attempt key", async () => {
  const r = runtime();
  r.memory.set("payout:actor-a", "prior attempt");
  await request(r.context)();
  assert.equal(r.memory.has("payout:actor-a"), false);
  assert.equal(r.calls.some(([name]) => name === "canonicalRead"), true);
  assert.equal(r.writes.some(([name]) => name === "lastRequest"), true);
});

test("payout recovery: session switch while canonical lookup is pending leaves idempotency key recoverable", async () => {
  const started = deferred(), returned = deferred();
  const r = runtime({ client: () => ({ readPartnerPayoutRequestByKey: () => {
    started.resolve(); return returned.promise;
  } }) });
  r.memory.set("payout:actor-a", "existing attempt");
  const pending = recover(r.context)();
  await started.promise;
  r.switchSession();
  returned.resolve({ request: requestView });
  await pending;
  assert.equal(r.memory.get("payout:actor-a"), "existing attempt");
  assert.equal(r.writes.some(([name]) => name === "lastRequest"), false);
});

test("payout: mismatched canonical readback leaves original attempt for investigation", async () => {
  const r = runtime({ matchesPartnerPayoutReadback: () => false });
  r.memory.set("payout:actor-a", "original saved attempt");
  await request(r.context)();
  assert.equal(r.memory.get("payout:actor-a"), "original saved attempt");
  assert.equal(r.writes.some(([name]) => name === "lastRequest"), false);
  assert.equal(r.writes.some(([name, msg]) => name === "error" && msg?.includes("لم نتأكد")), true);
});

test("payout recovery: canonical 404 retains the original idempotency key for safe review", async () => {
  const r = runtime({
    isDefinitiveDshMobileClientRejection: (cause) => cause?.status === 404,
    client: () => ({
      readPartnerPayoutRequestByKey: async () => {
        const missing = new Error("Not found");
        missing.status = 404;
        throw missing;
      },
    }),
  });
  await recover(r.context)();
  const preserved = JSON.parse(r.memory.get("payout:actor-a"));
  assert.equal(preserved.idempotencyKey, attempt.idempotencyKey);
  assert.equal(preserved.correlationID, attempt.correlationID);
  assert.equal(preserved.reviewRequired, true);
  assert.equal(r.writes.some(([name, value]) => name === "legacyKey" && value?.idempotencyKey === attempt.idempotencyKey), true);
  assert.equal(r.calls.some(([name]) => name === "createPayout"), false);
});

test("settlement intake: re-authentication before token resolves prevents wrong-session POST", async () => {
  const token = deferred();
  const r = runtime({ getUsableIdentityAccessToken: () => token.promise });
  const pending = requestIntake(r.context)();
  assert.equal(r.memory.has("intake:actor-a"), true);
  r.switchSession();
  token.resolve("new-session-token");
  await pending;
  assert.equal(r.calls.some(([name]) => name === "createIntake"), false);
  assert.equal(r.memory.has("intake:actor-a"), true);
});

test("settlement intake: session switch during canonical POST leaves saved original key and shows no false success", async () => {
  const started = deferred(), returned = deferred();
  const r = runtime({ client: () => ({
    createPartnerSettlementIntake: () => { started.resolve(); return returned.promise; },
  }) });
  const pending = requestIntake(r.context)();
  await started.promise;
  r.switchSession();
  returned.resolve({ intake: { status: "REQUESTED", resolvedAmountMinor: 900 } });
  await pending;
  assert.equal(r.memory.has("intake:actor-a"), true);
  assert.equal(r.calls.some(([name]) => name === "delete"), false);
  assert.equal(r.writes.some(([name, msg]) => name === "notice" && msg), false);
});

test("settlement intake: current-session verified acknowledgement clears only its own pending attempt", async () => {
  const r = runtime();
  await requestIntake(r.context)();
  assert.equal(r.memory.has("intake:actor-a"), false);
  assert.equal(r.writes.some(([name, value]) => name === "intake" && value?.status === "REQUESTED"), true);
  assert.equal(r.writes.some(([name, msg]) => name === "notice" && msg?.includes("وصل طلب")), true);
});
