import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/finance/settlement-intake-inbox.tsx", import.meta.url), "utf8");
const begin = source.indexOf("  const load = useCallback(async () => {");
const loadEnd = source.indexOf("  useEffect(() => { void load(); }, [load]);", begin);
const convertBegin = source.indexOf("  async function convert(id: string) {");
const cancelBegin = source.indexOf("  async function cancelIntake(id: string) {", convertBegin);
const mutationsEnd = source.indexOf("  return <>", cancelBegin);
assert.ok(begin >= 0 && loadEnd > begin && convertBegin > loadEnd && cancelBegin > convertBegin && mutationsEnd > cancelBegin);
const runnable = [
  source.slice(begin, loadEnd).replace(" as { intakes?: readonly Intake[] }", ""),
  source.slice(convertBegin, mutationsEnd)
    .replace("convert(id: string)", "convert(id)")
    .replace("cancelIntake(id: string)", "cancelIntake(id)")
    .replace(" as { error?: { message?: string } } | null", ""),
].join("\n");

function deferred() {
  let resolve, reject;
  const promise = new Promise((good, bad) => { resolve = good; reject = bad; });
  return { promise, resolve, reject };
}

function result(intakes = []) {
  return { ok: true, json: async () => ({ intakes }) };
}
const row = (id) => ({ id, actorId: "merchant-a", actorType: "partner", currency: "YER",
  resolvedAmountMinor: 100, storeAllocations: [], createdAt: "2026-11-11T00:00:00Z" });

function inbox(fetchImpl) {
  const readEpoch = { current: 0 }, mounted = { current: true }, actionInFlight = { current: false };
  const changes = [], requests = [];
  let selectedId = "intake-1", items = [], busyId = null, error = "", notice = "", loading = false;
  const change = (field, update) => {
    changes.push([field, update]);
    if (field === "selectedId") selectedId = typeof update === "function" ? update(selectedId) : update;
    if (field === "items") items = update;
    if (field === "busyId") busyId = update;
    if (field === "error") error = update;
    if (field === "notice") notice = update;
    if (field === "loading") loading = update;
  };
  const ctx = {
    mounted, readEpoch, actionInFlight, cancelReason: "Verified cancellation",
    useCallback: (callback) => callback,
    onCountChange: (count) => change("count", count),
    setItems: (value) => change("items", value),
    setSelectedId: (value) => change("selectedId", value),
    setError: (value) => change("error", value),
    setLoading: (value) => change("loading", value),
    setBusyId: (value) => change("busyId", value),
    setNotice: (value) => change("notice", value),
    setReviewOpen: (value) => change("reviewOpen", value),
    setCancelReason: (value) => change("cancelReason", value),
    fetch: (url, options) => {
      requests.push([url, options]);
      return fetchImpl(url, options);
    },
  };
  const actions = runInNewContext(`${runnable}\n({load,convert,cancelIntake});`, ctx);
  return { ...actions, mounted, readEpoch, actionInFlight, changes, requests,
    get items() { return items; }, get selectedId() { return selectedId; },
    get busyId() { return busyId; }, get error() { return error; },
    get notice() { return notice; }, get loading() { return loading; } };
}

test("a late older financial GET cannot replace the latest canonical list or count", async () => {
  const oldRead = deferred(), newRead = deferred();
  let call = 0;
  const ui = inbox(() => ++call === 1 ? oldRead.promise : newRead.promise);
  const old = ui.load();
  const newer = ui.load();
  newRead.resolve(result([row("intake-current")]));
  await newer;
  oldRead.resolve(result([row("intake-stale")]));
  await old;
  assert.equal(ui.items[0].id, "intake-current");
  assert.equal(ui.selectedId, null);
  assert.equal(ui.changes.filter(([name]) => name === "count").length, 1);
  assert.equal(ui.loading, false);
});

test("a response whose JSON finishes after a newer read is ignored", async () => {
  const oldJson = deferred();
  let requests = 0;
  const ui = inbox(async () => ++requests === 1
    ? { ok: true, json: () => oldJson.promise }
    : result([row("latest")]));
  const old = ui.load();
  await Promise.resolve();
  const newer = ui.load();
  await newer;
  oldJson.resolve({ intakes: [row("outdated")] });
  await old;
  assert.equal(ui.items[0].id, "latest");
  assert.equal(ui.changes.filter(([name]) => name === "count").length, 1);
});

test("stale read failure cannot overwrite newer financial data with an error", async () => {
  const oldRead = deferred();
  let requests = 0;
  const ui = inbox(() => ++requests === 1 ? oldRead.promise : Promise.resolve(result([row("valid")])));
  const old = ui.load();
  await ui.load();
  oldRead.reject(new Error("old network failure"));
  await old;
  assert.equal(ui.error, "");
  assert.equal(ui.items[0].id, "valid");
  assert.equal(ui.changes.filter(([name]) => name === "count" && name !== null).length, 1);
});

test("unmounted operator inbox cannot publish late financial amounts, errors or count callbacks", async () => {
  const pending = deferred();
  const ui = inbox(() => pending.promise);
  const old = ui.load();
  ui.mounted.current = false;
  ui.readEpoch.current += 1;
  pending.resolve(result([row("secret-from-old-session")]));
  await old;
  assert.equal(ui.items.length, 0);
  assert.equal(ui.changes.some(([name]) => name === "count"), false);
  assert.match(source, /mounted\.current = false; readEpoch\.current \+= 1/);
});

test("convert invalidates pre-action reads and serializes double-click conversion and cancellation", async () => {
  const oldGet = deferred(), post = deferred();
  let gets = 0, posts = 0;
  const ui = inbox((_url, options) => {
    if (options?.method === "POST") { posts += 1; return post.promise; }
    gets += 1;
    return gets === 1 ? oldGet.promise : Promise.resolve(result([]));
  });
  const before = ui.load();
  const first = ui.convert("intake-1");
  const duplicate = ui.convert("intake-1");
  const crossAction = ui.cancelIntake("intake-1");
  assert.equal(posts, 1);
  oldGet.resolve(result([row("old-before-convert")]));
  await before;
  assert.equal(ui.items.length, 0);
  post.resolve({ ok: true });
  await Promise.all([first, duplicate, crossAction]);
  assert.equal(gets, 2);
  assert.equal(ui.items.length, 0);
  assert.equal(ui.selectedId, null);
  assert.match(ui.notice, /أُحيل الطلب/);
  assert.equal(ui.actionInFlight.current, false);
  assert.equal(ui.busyId, null);
});

test("successful cancellation invalidates older reads and refreshes authoritative list", async () => {
  const oldGet = deferred();
  let gets = 0;
  const ui = inbox((_url, options) => {
    if (options?.method === "POST") return Promise.resolve({ ok: true });
    return ++gets === 1 ? oldGet.promise : Promise.resolve(result([]));
  });
  const before = ui.load();
  await ui.cancelIntake("intake-1");
  oldGet.resolve(result([row("cancelled-intake")]));
  await before;
  assert.equal(ui.items.length, 0);
  assert.match(ui.notice, /أُلغي طلب التسوية/);
  assert.equal(ui.actionInFlight.current, false);
  assert.equal(ui.requests.filter(([url]) => url.endsWith("/cancel")).length, 1);
});

test("failed finance POST does not claim cancellation success and unlocks retry", async () => {
  let failed = true;
  const ui = inbox((_url, options) => options?.method === "POST"
    ? Promise.resolve({ ok: !failed })
    : Promise.resolve(result([])));
  await ui.cancelIntake("intake-1");
  assert.equal(ui.notice, "");
  assert.match(ui.error, /لم يتم إلغاء/);
  assert.equal(ui.actionInFlight.current, false);
  failed = false;
  await ui.cancelIntake("intake-1");
  assert.match(ui.notice, /أُلغي طلب التسوية/);
});

test("unmounted converted request cannot fetch new operator session or display old success", async () => {
  const post = deferred();
  const ui = inbox(() => post.promise);
  const pending = ui.convert("intake-1");
  ui.mounted.current = false;
  ui.readEpoch.current += 1;
  post.resolve({ ok: true });
  await pending;
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.notice, "");
  assert.equal(ui.actionInFlight.current, false);
});
