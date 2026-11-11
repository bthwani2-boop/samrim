import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const cashSource = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const payoutSource = readFileSync(new URL("./captain-payout-card.tsx", import.meta.url), "utf8");
const actor = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "captain", subject, sessionId },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Execute the actual TypeScript callback/helper from the Captain screen, not a
// rewritten analogue of its financial guard. Only OS/network side effects are faked.
function production(source, name, runtime) {
  const ast = ts.createSourceFile("captain-finance.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      expression = node.getText(ast);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]?.getText(ast) ?? ""
        : node.initializer.getText(ast);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(expression, `production source is missing ${name}`);
  const declaration = expression.startsWith("function ")
    ? expression : `const ${name} = ${expression};`;
  const js = ts.transpileModule(
    `${declaration}; ({${name}});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(js, runtime)[name];
}

function makeCashHarness(tokenGate = deferred(), onCreate) {
  const state = { current: actor("captain-a", "login-1"), saved: [], stored: null, deleted: [], loads: 0, created: 0, errors: [], notices: [] };
  const enteredToken = deferred();
  const ref = { current: false };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    loadedSessionKey: captainSessionKey(state.current),
    busy: false,
    fundingInFlight: ref,
    wallet: { state: { providerMock: false, simulator: false } },
    amount: "2500",
    pending: null,
    providers: [],
    selectedProviderKey: "",
    toAsciiDigits: value => value,
    attemptKey: id => `bthwani.captain.cash-in.pending.v1.${encodeURIComponent(id)}`,
    Crypto: { randomUUID: () => "test-correlation" },
    SecureStore: {
      getItemAsync: async () => state.stored,
      setItemAsync: async (key, value) => { state.stored = value; state.saved.push({ key, value }); },
      deleteItemAsync: async key => { state.deleted.push(key); state.stored = null; },
    },
    getUsableIdentityAccessToken: async () => {
      enteredToken.resolve();
      return tokenGate.promise;
    },
    captainClient: () => ({
      createOwnFundingIntent: async () => {
        state.created++;
        if (onCreate) return onCreate(state);
        throw new Error("Former session invoked payment");
      },
    }),
    setBusy: () => {},
    setError: value => state.errors.push(value),
    setNotice: value => state.notices.push(value),
    setPending: () => {},
    setAmount: () => {},
    load: async () => { state.loads++; },
    console: { error: () => {} },
    __DEV__: false,
  };
  runtime.hasCurrentFundingSession = production(cashSource, "hasCurrentFundingSession", runtime);
  runtime.parseCaptainFundingAttempt = production(cashSource, "parseCaptainFundingAttempt", runtime);
  runtime.sameFundingAttempt = production(cashSource, "sameFundingAttempt", runtime);
  runtime.matchesCaptainFundingRequest = production(cashSource, "matchesCaptainFundingRequest", runtime);
  return { state, runtime, enteredToken, tokenGate, create: production(cashSource, "createIntent", runtime) };
}

function makePayoutHarness({ tokenGate = deferred(), mutationGate = null } = {}) {
  const state = { current: actor("captain-a", "login-1"), saved: [], deleted: [], requests: 0, reads: 0, errors: [], notices: [] };
  const enteredToken = deferred();
  const enteredMutation = deferred();
  const lock = { current: false };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    loadedSessionKey: captainSessionKey(state.current),
    busy: false,
    amount: "2000",
    pendingAttempt: null,
    pendingIntakeAttempt: null,
    state: { eligibleAvailableMinor: 5000 },
    financialRequestInFlight: lock,
    toAsciiDigits: value => value,
    Crypto: { randomUUID: () => "test-correlation" },
    SecureStore: {
      setItemAsync: async (key, value) => { state.saved.push({ key, value }); },
      getItemAsync: async () => null,
      deleteItemAsync: async key => { state.deleted.push(key); },
    },
    getUsableIdentityAccessToken: async () => {
      enteredToken.resolve();
      return tokenGate.promise;
    },
    captainClient: () => ({
      createOwnPayoutIntent: async () => {
        state.requests++;
        enteredMutation.resolve();
        return mutationGate ? mutationGate.promise : {
          payout: { id: "payout-1", actorType: "captain", actorId: "captain-a", resolvedAmountMinor: 2000 },
        };
      },
      readOwnPayoutState: async () => {
        state.reads++;
        return { state: { actorType: "captain", actorId: "captain-a", latestPayout: { id: "payout-1" } } };
      },
      createOwnSettlementIntake: async () => {
        state.requests++;
        enteredMutation.resolve();
        return { intake: { id: "intake-1", resolvedAmountMinor: 5000 } };
      },
      listOwnSettlementIntakes: async () => {
        state.reads++;
        return { intakes: [{ id: "intake-1", resolvedAmountMinor: 5000, status: "REQUESTED" }] };
      },
    }),
    setBusy: () => {},
    setError: value => state.errors.push(value),
    setNotice: value => state.notices.push(value),
    setPendingAttempt: () => {},
    setPendingIntakeAttempt: () => {},
    setAmount: () => {},
    setShowPartial: () => {},
    setIntake: () => {},
    load: async () => {},
    console: { error: () => {} },
  };
  runtime.hasCurrentPayoutSession = production(payoutSource, "hasCurrentPayoutSession", runtime);
  runtime.claimFinancialRequest = production(payoutSource, "claimFinancialRequest", runtime);
  return {
    state, runtime, enteredToken, tokenGate, enteredMutation, mutationGate,
    request: production(payoutSource, "request", runtime),
    requestIntake: production(payoutSource, "requestIntake", runtime),
  };
}

test("Cash-In refuses to overwrite another saved attempt after a stale wallet snapshot", async () => {
  const h = makeCashHarness();
  const savedAttempt = {
    version: 1, actorID: "captain-a", amountMinor: 2500,
    idempotencyKey: "captain_cashin_existing", correlationID: "captain_cashin_corr_existing",
  };
  h.state.stored = JSON.stringify(savedAttempt);
  await h.create();
  assert.equal(h.state.stored, JSON.stringify(savedAttempt));
  assert.equal(h.state.saved.length, 0, "no replacement of an unknown financial reference");
  assert.equal(h.state.created, 0, "no second WLT funding request");
  assert.equal(h.runtime.fundingInFlight.current, false);
  assert.ok(h.state.errors.some(Boolean), "ask for canonical retry/recovery");
});

test("Cash-In rejects a changed durable attempt before persisting a WLT response", async () => {
  const token = deferred();
  token.resolve("token");
  const h = makeCashHarness(token, async state => {
    state.stored = JSON.stringify({
      version: 1, actorID: "captain-a", amountMinor: 2500,
      idempotencyKey: "captain_cashin_other", correlationID: "captain_cashin_corr_other",
    });
    return {
      intent: {
        id: "intent-a", actorType: "captain", actorId: "captain-a",
        fundingPurpose: "CAPTAIN_TOPUP", amountMinor: 2500, currency: "YER",
        providerKey: "PROVIDER-A", state: "SETTLED",
      }, simulator: false,
    };
  });
  await h.create();
  assert.equal(h.state.created, 1);
  assert.equal(h.state.saved.length, 1, "old session must not overwrite another stored attempt");
  assert.match(h.state.stored, /captain_cashin_other/);
  assert.equal(h.state.deleted.length, 0);
  assert.equal(h.state.loads, 0, "unknown attempt requires explicit canonical recovery");
});

test("Cash-In keeps terminal attempt until the sole WLT owner readback reconciles it", async () => {
  const token = deferred();
  token.resolve("token");
  const h = makeCashHarness(token, async () => ({
    intent: {
      id: "intent-a", actorType: "captain", actorId: "captain-a",
      fundingPurpose: "CAPTAIN_TOPUP", amountMinor: 2500, currency: "YER",
      providerKey: "PROVIDER-A", state: "SETTLED",
    }, simulator: false,
  }));
  await h.create();
  assert.equal(h.state.created, 1);
  assert.equal(h.state.saved.length, 2, "retain idempotent recovery with WLT intent identity");
  assert.equal(h.state.deleted.length, 0, "submitter must never retire the durable retry");
  assert.equal(h.state.loads, 1, "canonical owner readback decides terminal cleanup");
  assert.match(h.state.stored, /intent-a/);
});

for (const [label, replacement] of [
  ["renewed same-actor session", actor("captain-a", "login-2")],
  ["different Captain actor", actor("captain-b", "login-1")],
]) {
  test(`cash-in production callback never creates intent after token delay and ${label}`, async () => {
    const h = makeCashHarness();
    const pending = h.create();
    await h.enteredToken.promise;
    h.state.current = replacement;
    h.tokenGate.resolve("old-token");
    await pending;
    assert.equal(h.state.created, 0);
    assert.equal(h.state.saved.length, 1, "old actor's unsent idempotent intent stays recoverable");
    assert.match(h.state.saved[0].key, /cash-in\.pending\.v1\.captain-a$/);
    assert.equal(h.runtime.fundingInFlight.current, false);
    assert.ok(h.state.errors.every(error => !error), "old session must not present new-session errors");
  });

  test(`payout production callback never persists or submits after token delay and ${label}`, async () => {
    const h = makePayoutHarness();
    const pending = h.request("SPECIFIED");
    await h.enteredToken.promise;
    h.state.current = replacement;
    h.tokenGate.resolve("old-token");
    await pending;
    assert.equal(h.state.requests, 0);
    assert.equal(h.state.saved.length, 0);
    assert.equal(h.runtime.financialRequestInFlight.current, false);
    assert.ok(h.state.errors.every(error => !error), "old session must not overwrite new-session error");
  });

  test(`intake production callback rejects stale session after SecureStore and ${label}`, async () => {
    const h = makePayoutHarness();
    const pending = h.requestIntake("FULL_AVAILABLE");
    await h.enteredToken.promise;
    h.state.current = replacement;
    h.tokenGate.resolve("old-token");
    await pending;
    assert.equal(h.state.requests, 0);
    assert.equal(h.state.saved.length, 1);
    assert.equal(h.state.deleted.length, 0, "old session must not erase the actor-scoped retry of a newer session");
    assert.equal(h.runtime.financialRequestInFlight.current, false);
  });
}

test("production payout and intake use one synchronous lock without a separate helper module", async () => {
  const token = deferred();
  const h = makePayoutHarness({ tokenGate: token });
  const first = h.request("SPECIFIED");
  await h.enteredToken.promise;
  assert.equal(h.runtime.financialRequestInFlight.current, true);
  await h.requestIntake("FULL_AVAILABLE");
  assert.equal(h.state.requests, 0, "intake cannot pass a pending payout");
  assert.equal(h.state.saved.length, 0, "intake cannot save another attempt");
  token.resolve("token");
  await first;
  assert.equal(h.state.requests, 1);
  assert.equal(h.runtime.financialRequestInFlight.current, false);
  await h.requestIntake("FULL_AVAILABLE");
  assert.equal(h.state.requests, 2, "intake can proceed after payout releases");
  assert.equal(h.runtime.financialRequestInFlight.current, false);
});

test("payout delayed server acknowledgement cannot clear recovery or expose stale readback", async () => {
  const token = deferred();
  token.resolve("token");
  const mutation = deferred();
  const h = makePayoutHarness({ tokenGate: token, mutationGate: mutation });
  const pending = h.request("SPECIFIED");
  await h.enteredMutation.promise;
  h.state.current = actor("captain-a", "login-2");
  mutation.resolve({ payout: { id: "payout-1" } });
  await pending;
  assert.equal(h.state.requests, 1, "in-flight old request may already have reached WLT");
  assert.equal(h.state.reads, 0, "no former-session owner readback");
  assert.equal(h.state.deleted.length, 0, "retain idempotent attempt for new session reconciliation");
  assert.equal(h.state.saved.length, 1);
  assert.ok(h.state.notices.every(value => !value), "no obsolete success notice");
});
