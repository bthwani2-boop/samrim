import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";
import { isOwnCustomerWalletResponse } from "./customer-wallet-readback.ts";

const source = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("cash-in-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (subject = "customer-a", sessionId = "session-1") => ({
  kind: "authenticated", identity: { role: "client", subject, sessionId },
});

const functions = new Map();
const variables = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(ast);
    const init = name === "load" && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    variables.set(name, init.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function production(runtime, names) {
  const code = [];
  for (const name of ["parseFundingAttempt", "isTerminalFundingIntent", "fundingIntentMatchesAttempt", "walletWithFundingIntent", "currentClientWalletSessionKey"]) {
    assert.ok(functions.has(name), `missing real production function: ${name}`);
    code.push(functions.get(name));
  }
  const needed = ["attemptKey", "load", "createIntent"];
  if (names.some(name => ["visibleWallet", "visiblePending", "visibleLastSettledAmount", "currentReadback"].includes(name))) {
    needed.push("sessionIsCurrent", "currentReadback", "visibleWallet", "visiblePending", "visibleLastSettledAmount");
  }
  for (const name of needed) {
    assert.ok(variables.has(name), `missing real production binding: ${name}`);
    const expr = variables.get(name);
    code.push(`const ${name} = ${expr};`);
  }
  const js = ts.transpileModule(`${code.join("\n")}\n({${names.join(", ")}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(js, { clientSessionKey, isOwnCustomerWalletResponse, ...runtime });
}

function fixture() {
  let identity = actor();
  let serial = 0;
  const sessionKey = clientSessionKey(identity);
  const intent = {
    id: "intent-1", actorType: "customer", actorId: "customer-a", currency: "YER",
    fundingPurpose: "CUSTOMER_TOPUP", amountMinor: 1500,
    providerKey: "DEVELOPMENT_SIMULATOR", state: "PENDING_PROVIDER",
  };
  const wallet = {
    state: {
      actorType: "customer", actorId: "customer-a", currency: "YER",
      simulator: true, providerMock: false, cashInEnabled: true, availableMinor: 100,
      recentCompensations: [{ id: "credit-1", orderId: "order-1", amountMinor: 50, currency: "YER" }],
    },
    fundingIntents: [],
  };
  const store = new Map();
  const events = { reads: 0, creates: 0, wallets: [], pending: [], loaded: [], deleted: [], errors: [], notices: [], settled: [] };
  const apiClient = {
    readOwnWallet: async () => { events.reads++; return wallet; },
    readOwnFundingIntent: async () => ({ intent }),
    createOwnFundingIntent: async () => { events.creates++; return { intent, simulator: false }; },
    reconcileOwnFundingIntent: async () => { throw Error("unexpected reconcile"); },
    simulateOwnFundingIntent: async () => { throw Error("unexpected simulate"); },
  };
  const runtime = {
    currentIdentityState: () => identity,
    sessionKey, loadedSessionKey: sessionKey, currentReadback: true,
    wallet, pending: null, busy: false, amount: "1500",
    selectedProviderKey: "DEVELOPMENT_SIMULATOR", providers: [],
    simulatorInDevelopment: true, providerMockInDevelopment: false, simulatorOutcome: "SUCCESS",
    readSequence: { current: 0 }, fundingInFlight: { current: false },
    getUsableIdentityAccessToken: async () => "token-1",
    createClientDsh: () => apiClient,
    SecureStore: {
      getItemAsync: async key => store.get(key) ?? null,
      setItemAsync: async (key, value) => { store.set(key, value); },
      deleteItemAsync: async key => { events.deleted.push(key); store.delete(key); },
    },
    Crypto: { randomUUID: () => String(++serial).padStart(10, "0") },
    toAsciiDigits: value => value,
    cashInSimulatorMutationHeaders: () => { throw Error("unexpected simulator"); },
    cashInSimulatorStateMatches: () => false,
    setBusy: () => {},
    setError: value => events.errors.push(value),
    setNotice: value => events.notices.push(value),
    setWallet: value => events.wallets.push(value),
    setPending: value => events.pending.push(value),
    setLoadedSessionKey: value => events.loaded.push(value),
    setLastSettledAmount: value => events.settled.push(value),
    setAmount: () => {},
  };
  return {
    runtime, wallet, intent, store, events, apiClient, sessionKey,
    renew: () => { identity = actor("customer-a", "session-2"); },
    switchActor: () => { identity = actor("customer-b", "session-1"); },
    logout: () => { identity = { kind: "signed_out" }; },
    sameSession: () => { identity = actor("customer-a", "session-1"); },
    saved: () => ({
      version: 1, actorID: "customer-a", amountMinor: 1500,
      idempotencyKey: "cashin_existing", correlationID: "cashin_corr_existing",
      fundingIntentID: "intent-1", providerKey: "DEVELOPMENT_SIMULATOR",
    }),
  };
}

test("visible private balance, compensation history and funding success use exact Client session", () => {
  const x = fixture();
  const visible = () => production({
    ...x.runtime, pending: x.saved(), lastSettledAmount: 1500,
  }, ["currentReadback", "visibleWallet", "visiblePending", "visibleLastSettledAmount"]);
  assert.equal(visible().currentReadback, true);
  assert.equal(visible().visibleWallet.state.actorId, "customer-a");
  x.sameSession();
  assert.equal(visible().visiblePending.amountMinor, 1500);
  x.renew();
  assert.equal(visible().currentReadback, false);
  assert.equal(visible().visibleWallet, null);
  assert.equal(visible().visiblePending, null);
  assert.equal(visible().visibleLastSettledAmount, null);
  x.switchActor();
  assert.equal(visible().visibleWallet, null);
  x.logout();
  assert.equal(visible().visibleWallet, null);
  assert.match(source, /const state = visibleWallet\?\.state/);
  assert.match(source, /if\(mode==="cash-in" && visibleLastSettledAmount!==null\)/);
});

test("current session reads canonical customer wallet, then marks its owner", async () => {
  const x = fixture();
  await production(x.runtime, ["load"]).load();
  assert.equal(x.events.reads, 1);
  assert.equal(x.events.wallets.at(-1).state.actorId, "customer-a");
  assert.equal(x.events.loaded.at(-1), x.sessionKey);
});

test("same-actor renewed session before access token prevents old wallet request", async () => {
  const x = fixture();
  let release;
  x.runtime.getUsableIdentityAccessToken = () => new Promise(resolve => { release = resolve; });
  const reading = production(x.runtime, ["load"]).load();
  x.renew();
  release("old-token");
  await reading;
  assert.equal(x.events.reads, 0);
  assert.ok(!x.events.wallets.some(Boolean));
});

test("late old wallet response never displays under a renewed Identity session", async () => {
  const x = fixture();
  let release, started;
  const request = new Promise(resolve => { started = resolve; });
  x.apiClient.readOwnWallet = () => { x.events.reads++; started(); return new Promise(resolve => { release = resolve; }); };
  const reading = production(x.runtime, ["load"]).load();
  await request;
  x.renew();
  release(x.wallet);
  await reading;
  assert.ok(!x.events.wallets.some(Boolean));
  assert.ok(!x.events.loaded.includes(x.sessionKey));
});

test("newer wallet load takes precedence over an older same-session read", async () => {
  const x = fixture();
  let release, started, calls = 0;
  const request = new Promise(resolve => { started = resolve; });
  x.apiClient.readOwnWallet = () => {
    calls++;
    if (calls === 1) {
      started();
      return new Promise(resolve => { release = resolve; });
    }
    return Promise.resolve(x.wallet);
  };
  const load = production(x.runtime, ["load"]).load;
  const first = load();
  await request;
  await load();
  release(x.wallet);
  await first;
  assert.equal(x.events.loaded.filter(value => value === x.sessionKey).length, 1);
});

test("incorrect wallet actor is rejected without becoming visible", async () => {
  const x = fixture();
  x.apiClient.readOwnWallet = async () => ({ ...x.wallet, state: { ...x.wallet.state, actorId: "customer-b" } });
  await production(x.runtime, ["load"]).load();
  assert.ok(!x.events.wallets.some(Boolean));
  assert.ok(!x.events.loaded.includes(x.sessionKey));
  assert.ok(x.events.errors.at(-1)?.length);
});

test("old-session recovered funding cannot erase actor-owned retry state", async () => {
  const x = fixture();
  const key = "bthwani.client.cash-in.pending.v1.customer-a";
  x.store.set(key, JSON.stringify(x.saved()));
  let release, started;
  const request = new Promise(resolve => { started = resolve; });
  x.apiClient.readOwnFundingIntent = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const reading = production(x.runtime, ["load"]).load();
  await request;
  x.renew();
  release({ intent: { ...x.intent, state: "SETTLED" } });
  await reading;
  assert.equal(x.events.deleted.length, 0);
  assert.equal(JSON.parse(x.store.get(key)).idempotencyKey, x.saved().idempotencyKey);
});

test("terminal funding readback clears only matching durable attempt", async () => {
  const x = fixture();
  const key = "bthwani.client.cash-in.pending.v1.customer-a";
  x.store.set(key, JSON.stringify(x.saved()));
  const settled = { ...x.intent, state: "SETTLED" };
  x.wallet.fundingIntents.push(settled);
  x.apiClient.readOwnFundingIntent = async () => ({ intent: settled });
  await production(x.runtime, ["load"]).load();
  assert.deepEqual(x.events.deleted, [key]);
  assert.equal(x.store.has(key), false);
  assert.equal(x.events.pending.at(-1), null);
});

test("after Identity renewal during token acquisition, a cash-in cannot launch a DSH mutation", async () => {
  const x = fixture();
  let release, started;
  const tokenRequested = new Promise(resolve => { started = resolve; });
  x.runtime.getUsableIdentityAccessToken = () => {
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const writing = production(x.runtime, ["createIntent"]).createIntent();
  await tokenRequested;
  x.renew();
  release("old-token");
  await writing;
  assert.equal(x.events.creates, 0);
  assert.equal(x.store.size, 1, "retain the original idempotency evidence");
  assert.equal(x.events.deleted.length, 0);
});

test("rapid cash-in double clicks cause only one canonical DSH create request", async () => {
  const x = fixture();
  let release, started;
  const request = new Promise(resolve => { started = resolve; });
  x.apiClient.createOwnFundingIntent = () => {
    x.events.creates++;
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const createIntent = production(x.runtime, ["createIntent"]).createIntent;
  const first = createIntent();
  await request;
  await createIntent();
  assert.equal(x.events.creates, 1);
  release({ intent: x.intent, simulator: false });
  await first;
  assert.equal(x.runtime.fundingInFlight.current, false);
});

test("a late settled acknowledgement from former same-actor session never claims success", async () => {
  const x = fixture();
  let release, started;
  const request = new Promise(resolve => { started = resolve; });
  x.apiClient.createOwnFundingIntent = () => {
    x.events.creates++;
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const writing = production(x.runtime, ["createIntent"]).createIntent();
  await request;
  x.renew();
  release({ intent: { ...x.intent, state: "SETTLED" }, simulator: false });
  await writing;
  assert.equal(x.events.deleted.length, 0);
  assert.equal(x.events.settled.length, 0);
  assert.ok(!x.events.notices.some(value => value?.includes("تمت")));
  assert.equal(JSON.parse([...x.store.values()][0]).fundingIntentID, undefined);
});

test("settled cash-in clears its own retry key only after WLT-backed wallet readback", async () => {
  const x = fixture();
  const settled = { ...x.intent, state: "SETTLED" };
  x.wallet.fundingIntents.push(settled);
  x.apiClient.createOwnFundingIntent = async () => ({ intent: settled, simulator: false });
  await production(x.runtime, ["createIntent"]).createIntent();
  assert.equal(x.events.deleted.length, 1);
  assert.equal(x.store.size, 0);
  assert.deepEqual(x.events.settled, [1500]);
});

test("missing settled wallet evidence preserves the funding retry attempt, without optimistic success", async () => {
  const x = fixture();
  x.apiClient.createOwnFundingIntent = async () => ({ intent: { ...x.intent, state: "SETTLED" }, simulator: false });
  await production(x.runtime, ["createIntent"]).createIntent();
  assert.equal(x.events.deleted.length, 0);
  assert.equal(x.events.settled.length, 0);
  assert.equal(x.store.size, 1);
  assert.ok(x.events.errors.at(-1)?.length);
});

test("one original WLT/DSH engine and existing actor-specific secure retry key remain", () => {
  assert.match(source, /createClientDsh\(\)/);
  assert.doesNotMatch(source, /createDshMobileClient/);
  const dshBootstrap = readFileSync(new URL("../../bootstrap/dsh.ts", import.meta.url), "utf8");
  assert.match(dshBootstrap, /createDshMobileClient\(clientDshBaseURL\(\), \{ cryptoRandomUUID: \(\) => Crypto\.randomUUID\(\) \}\)/);
  assert.match(source, /bthwani\.client\.cash-in\.pending\.v1/);
  assert.match(source, /client\.createOwnFundingIntent\(token, parsedAmount, attempt\.idempotencyKey, attempt\.correlationID, attempt\.providerKey\)/);
  assert.match(source, /fundingInFlight\.current = true/);
  assert.match(source, /fundingInFlight\.current = false/);
  assert.match(source, /subscribeIdentitySession\(\(\) =>/);
  assert.match(source, /readSequence\.current \+= 1/);
  assert.match(source, /setLoadedSessionKey\(sessionKey\)/);
});


test("same-account session subscription resets private wallet state without resetting token-refresh view", () => {
  let identity = actor();
  const originalKey = clientSessionKey(identity);
  const events = [];
  let subscription;
  const runtime = {
    currentIdentityState: () => identity,
    sessionKeyRef: { current: originalKey },
    readSequence: { current: 4 },
    subscribeIdentitySession: cb => { subscription = cb; return () => {}; },
    setSessionKey: value => events.push(["session", value]),
    setLoadedSessionKey: value => events.push(["loaded", value]),
    setWallet: value => events.push(["wallet", value]),
    setPending: value => events.push(["pending", value]),
    setLastSettledAmount: value => events.push(["settled", value]),
    setSelectedProviderKey: value => events.push(["provider", value]),
    setProviders: value => events.push(["providers", Array.from(value)]),
    setProvidersStatus: value => events.push(["providersStatus", value]),
    setBusy: value => events.push(["busy", value]),
    setError: value => events.push(["error", value]),
    setNotice: value => events.push(["notice", value]),
  };
  let effect = "";
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
        node.arguments[0]?.getText(ast).includes("subscribeIdentitySession")) {
      effect = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect, "real Identity subscription exists");
  const helper = functions.get("currentClientWalletSessionKey");
  const js = ts.transpileModule(`${helper}\nconst install = ${effect};\ninstall;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { clientSessionKey, ...runtime })();
  identity = actor("customer-a", "session-1");
  subscription();
  assert.equal(runtime.readSequence.current, 4);
  assert.equal(events.length, 0);
  identity = actor("customer-a", "session-2");
  subscription();
  assert.equal(runtime.readSequence.current, 5);
  assert.equal(events[0][0], "session");
  assert.equal(events[0][1], clientSessionKey(identity));
  assert.deepEqual(events.filter(value => ["wallet", "pending", "settled"].includes(value[0])).map(value => value[1]), [null, null, null]);
});

test("a new session recovers a confirmed pending funding intent using the original actor-specific key", async () => {
  const x = fixture();
  const key = "bthwani.client.cash-in.pending.v1.customer-a";
  const saved = x.saved();
  x.store.set(key, JSON.stringify(saved));
  x.runtime.pending = saved;
  await production(x.runtime, ["createIntent"]).createIntent();
  assert.equal(x.events.creates, 0, "known funding intent must not create another DSH funding request");
  assert.equal(JSON.parse(x.store.get(key)).idempotencyKey, saved.idempotencyKey);
  assert.equal(x.events.deleted.length, 0);
});

test("a completed older funding attempt cannot delete a newer retry record for the same actor", async () => {
  const x = fixture();
  const key = "bthwani.client.cash-in.pending.v1.customer-a";
  const saved = x.saved();
  x.store.set(key, JSON.stringify(saved));
  const settled = { ...x.intent, state: "SETTLED" };
  x.wallet.fundingIntents.push(settled);
  x.apiClient.readOwnFundingIntent = async () => {
    x.store.set(key, JSON.stringify({ ...saved, idempotencyKey: "cashin_newer-attempt" }));
    return { intent: settled };
  };
  await production(x.runtime, ["load"]).load();
  assert.equal(x.events.deleted.length, 0);
  assert.equal(JSON.parse(x.store.get(key)).idempotencyKey, "cashin_newer-attempt");
});
