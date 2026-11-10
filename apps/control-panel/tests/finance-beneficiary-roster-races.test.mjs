import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/finance/finance-unified-settlements.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const generation=useRef(0);");
const end = source.indexOf("  const records=useMemo", start);
assert.ok(start >= 0 && end > start, "evaluate the real production reader");
const compiled = stripTypeScriptTypes(
  `${source.slice(start, end)}\nglobalThis.captured = {loadRoster, actorTypes, generation, pageInFlight, requestController};`,
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function page(type, id, cursor = "") {
  return { ok: true, status: 200, json: async () => ({
    beneficiaries: [{ actorType: type, actorId: id, eligibleAvailableMinor: 5, heldMinor: 0, currency: "YER" }],
    nextCursor: cursor,
  }) };
}

function harness(fetchPage, { actor = "all", kind = "beneficiary" } = {}) {
  const state = { roster: [], cursors: {}, loaded: [], failedTypes: [], loading: false, error: "" };
  const calls = [], effects = [];
  const setters = Object.fromEntries(["roster", "cursors", "loaded", "failedTypes", "loading", "error"]
    .map((field) => [`set${field[0].toUpperCase()}${field.slice(1)}`, (value) => {
      state[field] = typeof value === "function" ? value(state[field]) : value;
    }]));
  const context = {
    actor, kind, ...setters,
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useEffect: (fn) => { effects.push(fn); },
    actorNames: { partner: "الشريك", captain: "الكابتن", field: "الميدان" },
    URLSearchParams, AbortController,
    fetch: (url, options) => {
      const q = new URL(url, "http://localhost").searchParams;
      const type = q.get("actorType"), cursor = q.get("cursor") ?? "";
      calls.push({ type, cursor, signal: options.signal });
      return fetchPage(type, cursor, options.signal);
    },
  };
  runInNewContext(compiled, context);
  const h = context.captured;
  return { ...h, state, calls, effects,
    initial: () => h.loadRoster(h.actorTypes),
    next: () => h.loadRoster(h.actorTypes, true, state.cursors, state.failedTypes) };
}
const ids = (h) => h.state.roster.map((row) => row.actorId).join(",");

test("initial roster preserves the successful financial source when another fails", async () => {
  const h = harness((type) => type === "partner"
    ? Promise.resolve(page(type, "p1", "p2")) : Promise.reject(new Error("captain offline")));
  await h.initial();
  assert.equal(ids(h), "p1");
  assert.equal(h.state.cursors.partner, "p2");
  assert.equal(h.state.failedTypes.join(","), "captain");
  assert.match(h.state.error, /جزئية/);
  assert.equal(h.state.loading, false);
});

test("retry reads only the failed first page, not a completed beneficiary source", async () => {
  let attempts = 0;
  const h = harness((type) => type === "partner" ? Promise.resolve(page(type, "p1"))
    : ++attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(page(type, "c1")));
  await h.initial();
  await h.next();
  assert.equal(ids(h), "p1,c1");
  assert.equal(h.calls.filter((call) => call.type === "partner").length, 1);
  assert.equal(attempts, 2);
  assert.equal(h.state.failedTypes.length, 0);
  assert.equal(h.state.error, "");
});

test("partial pagination retains every actor cursor and recovers missed actor page", async () => {
  let failures = 0;
  const h = harness((type, cursor) => {
    if (type === "partner") {
      if (cursor === "") return Promise.resolve(page(type, "p1", "p2"));
      if (cursor === "p2") return Promise.resolve(page(type, "p2", "p3"));
      if (cursor === "p3") return Promise.resolve(page(type, "p3"));
    }
    if (type === "captain") {
      if (cursor === "") return Promise.resolve(page(type, "c1", "c2"));
      if (cursor === "c2") {
        if (++failures === 1) return Promise.reject(new Error("captain page failed"));
        return Promise.resolve(page(type, "c2"));
      }
    }
    throw Error("unexpected page");
  });
  await h.initial();
  await h.next();
  assert.equal(ids(h), "p1,c1,p2");
  assert.equal(h.state.cursors.partner, "p3");
  assert.equal(h.state.cursors.captain, "c2");
  assert.equal(h.state.failedTypes.join(","), "captain");
  await h.next();
  assert.equal(ids(h), "p1,c1,p2,p3,c2");
  assert.equal(h.state.failedTypes.length, 0);
  assert.equal(h.state.cursors.partner, "");
  assert.equal(h.state.cursors.captain, "");
});

test("two clicks in the same turn cannot append a financial page twice", async () => {
  const pending = deferred();
  let pageRequests = 0;
  const h = harness((type, cursor) => {
    if (cursor) { pageRequests += 1; return pending.promise; }
    return Promise.resolve(page(type, type === "partner" ? "p1" : "c1", type === "partner" ? "p2" : ""));
  });
  await h.initial();
  const first = h.next(), second = h.next();
  assert.equal(pageRequests, 1);
  assert.equal(h.pageInFlight.current, true);
  pending.resolve(page("partner", "p2"));
  await Promise.all([first, second]);
  assert.equal(ids(h), "p1,c1,p2");
  assert.equal(h.pageInFlight.current, false);
});

test("new actor selection aborts an older read and ignores its late results", async () => {
  const old = deferred();
  const h = harness((type) => type === "partner" ? old.promise : Promise.resolve(page("captain", "current")));
  const first = h.loadRoster(["partner"]);
  const signal = h.calls[0].signal;
  await h.loadRoster(["captain"]);
  assert.equal(signal.aborted, true);
  old.resolve(page("partner", "old"));
  await first;
  assert.equal(ids(h), "current");
  assert.equal(h.state.loaded.join(","), "captain");
});

test("unmount aborts both requests and suppresses late financial rows", async () => {
  const waiting = deferred();
  const h = harness(() => waiting.promise);
  const cleanup = h.effects[0]();
  assert.equal(h.calls.length, 2);
  cleanup();
  assert.equal(h.calls.every((call) => call.signal.aborted), true);
  waiting.resolve(page("partner", "old"));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.roster.length, 0);
  assert.equal(h.state.failedTypes.length, 0);
});

test("switching to another finance registry clears a cancelled roster spinner and error", () => {
  const h = harness(() => { throw new Error("unexpected beneficiary request"); }, { kind: "withdrawal" });
  h.state.loading = true;
  h.state.error = "old beneficiary source failed";
  h.effects[0]();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, "");
});

test("a provider returning another actor's records is rejected", async () => {
  const h = harness((type) => Promise.resolve(type === "partner"
    ? page("captain", "wrong") : page("captain", "correct")));
  await h.initial();
  assert.equal(ids(h), "correct");
  assert.equal(h.state.failedTypes.join(","), "partner");
});

test("historical field source stays scoped to the field actor and uses no partner/captain paging", async () => {
  const h = harness((type) => Promise.resolve(page(type, "archived-field")), { actor: "field" });
  await h.initial();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "field");
  assert.equal(ids(h), "archived-field");
  assert.equal(h.state.roster[0].actorType, "field");
});

test("permission-denied financial registry responses never show prior funds and permit retry", async () => {
  const h = harness(() => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) }));
  await h.initial();
  assert.equal(h.state.roster.length, 0);
  assert.equal(h.state.loaded.length, 0);
  assert.equal(h.state.failedTypes.join(","), "partner,captain");
  assert.match(h.state.error, /أعد المحاولة/);
  assert.equal(h.state.loading, false);
});

test("no cursor or failed actor means no extra request", async () => {
  const h = harness((type) => Promise.resolve(page(type, `${type}-last`)));
  await h.initial();
  await h.next();
  assert.equal(h.calls.length, 2);
  assert.equal(ids(h), "partner-last,captain-last");
});

test("financial registry uses accessible table headings and explains unavailable data", () => {
  assert.match(source, /<caption className="sr-only">سجلات الصرف والتسويات المعروضة<\/caption>/);
  assert.equal(source.split('<th scope="col">').length - 1, 6);
  assert.match(source, /aria-label=\{\x60تفاصيل \$\{record\.name\}\x60\}/);
  assert.match(source, /لم تكتمل قراءة مصادر المستحقات؛ أعد المحاولة/);
});

test("one canonical frontend reader and visible retry replace the duplicate code", () => {
  assert.equal(source.split("await fetch(").length - 1, 1);
  assert.match(source, /const canLoadMore=/);
  assert.match(source, /إعادة محاولة المصادر المتعثرة/);
  assert.match(source, /loadRoster\(actorTypes,true,cursors,failedTypes\)/);
});
