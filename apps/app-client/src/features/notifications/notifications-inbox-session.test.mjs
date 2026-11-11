import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";

const source = readFileSync(new URL("./notifications-inbox.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("notifications-inbox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "client", subject, sessionId },
});

function production(runtime, names) {
  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      functions.set(node.name.text, node.getText(ast));
    }
    if (ts.isVariableDeclaration(node) && ["load", "loadMore"].includes(node.name.getText(ast)) &&
        ts.isCallExpression(node.initializer)) {
      functions.set(node.name.getText(ast), "const " + node.name.getText(ast) + " = " +
        node.initializer.arguments[0].getText(ast) + ";");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const required = ["currentClientNotificationsSessionKey", ...names];
  for (const name of required) assert.ok(functions.has(name), "missing production " + name);
  const program = required.map(name => functions.get(name)).join("\n") +
    "\n({ " + names.join(", ") + " })";
  const output = ts.transpileModule(program, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(output, { clientSessionKey, console: { error: () => {} }, ...runtime });
}

function harness(overrides = {}) {
  let current = actor("client-a", "first");
  const sessionKey = clientSessionKey(current);
  const observed = { items: [], shares: [], credits: [], unread: -1, loadedSession: "", writes: 0, navigation: [],
    shareFetches: 0, walletFetches: 0, firstFetches: 0, errors: [], refreshes: 0 };
  const api = {
    listNotifications: async () => {
      observed.firstFetches++;
      return { notifications: [{ id: "notice-a", readAt: null, orderId: "order-a" }], unreadCount: 1 };
    },
    readOwnWallet: async () => {
      observed.walletFetches++;
      return { state: { recentCompensations: [{ id: "credit-a", amountMinor: 500 }] } };
    },
    listClientShares: async () => {
      observed.shareFetches++;
      return { items: [{ id: "share-a" }], unreadCount: 1, nextBefore: 0 };
    },
    markNotificationRead: async () => { observed.writes++; },
    markClientShareRead: async () => { observed.writes++; },
    blockClientShareSender: async () => { observed.writes++; },
  };
  const runtime = {
    sessionKey, loadedSessionKey: sessionKey, loadSequence: { current: 0 }, pageSequence: { current: 0 },
    currentIdentityState: () => current, getUsableIdentityAccessToken: async () => "first-session-token",
    createClientDsh: () => api, setItems: value => {
      observed.items = typeof value === "function" ? value(observed.items) : value;
    },
    setShares: value => {
      observed.shares = typeof value === "function" ? value(observed.shares) : value;
    },
    setWalletCredits: value => { observed.credits = value; },
    setUnreadCount: value => { observed.unread = value; },
    setLoadedSessionKey: value => { observed.loadedSession = value; },
    setShareBefore: () => {}, setShareUnread: () => {}, setShareError: value => observed.errors.push(value),
    setNextCursor: () => {}, setMoreError: value => observed.errors.push(value),
    setLoading: () => {}, setLoadingMore: () => {}, setRefreshing: () => {},
    setError: value => observed.errors.push(value), setBusy: () => {}, setShareBusy: () => {},
    router: { push: value => observed.navigation.push(value) },
    busy: "", shareBusy: false, shareBefore: 99, nextCursor: "page-2",
    loading: false, loadingMore: false, refreshing: false,
    load: async () => { observed.refreshes++; },
    ...overrides,
  };
  return {
    runtime, observed, api, sessionKey,
    renew: () => { current = actor("client-a", "second"); },
    switchActor: () => { current = actor("client-b", "first"); },
    logout: () => { current = { kind: "signed_out" }; },
  };
}

test("current Client session loads notifications, wallet credits, and shares together", async () => {
  const x = harness();
  const { load } = production(x.runtime, ["load"]);
  await load();
  assert.deepEqual(Array.from(x.observed.items, item => item.id), ["notice-a"]);
  assert.deepEqual(Array.from(x.observed.shares, item => item.id), ["share-a"]);
  assert.deepEqual(Array.from(x.observed.credits, item => item.id), ["credit-a"]);
  assert.equal(x.observed.loadedSession, x.sessionKey);
});

test("same actor renewed session cannot accept late personal wallet and share responses", async () => {
  let finishWallet;
  let started;
  const walletStarted = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.readOwnWallet = async () => {
    started();
    return new Promise(resolve => { finishWallet = resolve; });
  };
  const { load } = production(x.runtime, ["load"]);
  const pending = load();
  await walletStarted;
  x.renew();
  finishWallet({ state: { recentCompensations: [{ id: "credit-from-old-session" }] } });
  await pending;
  assert.equal(x.observed.shares.length, 0);
  assert.equal(x.observed.credits.length, 0);
  assert.equal(x.observed.loadedSession, "");
});

test("a renewed session before access-token completion cannot call private DSH read", async () => {
  let unlock;
  const x = harness({
    getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }),
  });
  const { load } = production(x.runtime, ["load"]);
  const pending = load();
  x.renew();
  unlock("previous-token");
  await pending;
  assert.equal(x.observed.firstFetches, 0);
  assert.equal(x.observed.walletFetches, 0);
});

test("old same-actor token cannot write or navigate notification mark-read after renewal", async () => {
  let unlock;
  const x = harness({
    getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }),
  });
  const { openNotification } = production(x.runtime, ["openNotification"]);
  const pending = openNotification({ id: "n", readAt: null, orderId: "a" });
  x.renew();
  unlock("previous-token");
  await pending;
  assert.equal(x.observed.writes, 0);
  assert.equal(x.observed.navigation.length, 0);
});

test("notification mark-read response arriving after renewal does not navigate", async () => {
  let unblockWrite;
  let started;
  const writeStarted = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.markNotificationRead = async () => {
    x.observed.writes++; started();
    return new Promise(resolve => { unblockWrite = resolve; });
  };
  const { openNotification } = production(x.runtime, ["openNotification"]);
  const pending = openNotification({ id: "n", readAt: null, orderId: "a" });
  await writeStarted;
  x.renew();
  unblockWrite();
  await pending;
  assert.equal(x.observed.writes, 1);
  assert.equal(x.observed.navigation.length, 0);
});

test("share pagination response from prior session cannot append private records", async () => {
  let finishShares;
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.listClientShares = async () => {
    started();
    return new Promise(resolve => { finishShares = resolve; });
  };
  const { loadMoreShares } = production(x.runtime, ["loadMoreShares"]);
  const pending = loadMoreShares();
  await requested;
  x.switchActor();
  finishShares({ items: [{ id: "private-share" }], nextBefore: 0, unreadCount: 1 });
  await pending;
  assert.equal(x.observed.shares.length, 0);
});

test("share mark-read and block-sender actions do not mutate after token renewal", async () => {
  for (const name of ["openShare", "blockShareSender"]) {
    let unlock;
    const x = harness({
      getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }),
    });
    const result = production(x.runtime, [name]);
    const pending = result[name]({ id: "share-a", senderActorId: "sender-a", contentKind: "STORE", storeId: "store-a" });
    x.renew();
    unlock("old-token");
    await pending;
    assert.equal(x.observed.writes, 0, name);
    assert.equal(x.observed.navigation.length, 0, name);
  }
});

test("inbox rendering and pagination fail closed until current actor and session own loaded content", () => {
  assert.match(source, /const authenticated = Boolean\(sessionKey\) && currentClientNotificationsSessionKey\(\) === sessionKey/);
  assert.match(source, /loading \|\| loadedSessionKey !== sessionKey/);
  assert.match(source, /if \(sessionKeyRef\.current === nextSessionKey\) return/);
  assert.match(source, /loadedSessionKey !== sessionKey \|\| !nextCursor/);
  assert.doesNotMatch(source, /activeClientActorID|setActorID/);
  const original = clientSessionKey(actor("client-a", "first"));
  assert.notEqual(original, clientSessionKey(actor("client-a", "second")));
  assert.equal(clientSessionKey({ kind: "signed_out" }), "");
});

test("stale notification pagination cannot append another page after session rotation", async () => {
  let completePage;
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.listNotifications = async (_token, _limit, cursor) => {
    assert.equal(cursor, "page-2");
    started();
    return new Promise(resolve => { completePage = resolve; });
  };
  const { loadMore } = production(x.runtime, ["loadMore"]);
  const pending = loadMore();
  await requested;
  x.renew();
  completePage({ notifications: [{ id: "old-private-page" }], unreadCount: 5, nextCursor: "" });
  await pending;
  assert.equal(x.observed.items.length, 0);
});

test("late share read/block completion cannot navigate or refresh under another session", async () => {
  for (const name of ["openShare", "blockShareSender"]) {
    let releaseWrite;
    let started;
    const requested = new Promise(resolve => { started = resolve; });
    const x = harness();
    const deferred = async () => {
      x.observed.writes++;
      started();
      return new Promise(resolve => { releaseWrite = resolve; });
    };
    x.api.markClientShareRead = deferred;
    x.api.blockClientShareSender = deferred;
    const { [name]: action } = production(x.runtime, [name]);
    const pending = action({ id: "s", senderActorId: "sender-a", contentKind: "STORE", storeId: "store-a" });
    await requested;
    x.renew();
    releaseWrite();
    await pending;
    assert.equal(x.observed.writes, 1);
    assert.equal(x.observed.navigation.length, 0);
    assert.equal(x.observed.refreshes, 0);
  }
});
