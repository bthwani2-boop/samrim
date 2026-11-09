import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(
  path.resolve(import.meta.dirname, "../src/features/stores/independent-stores-workspace.tsx"), "utf8",
);
const effect = source.match(/  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[query, state, cursor, refresh\]\);/)?.[0];
assert.ok(effect, "test the actual registry GET effect, not a duplicate");

function simulateRead(fetch, { query = "", state = "", cursor = "" } = {}) {
  let cleanup;
  const writes = { page: [], loading: [], errors: [], selected: [] };
  const code = ts.transpile(effect, { target: ts.ScriptTarget.ES2022 });
  runInNewContext(code, {
    query, state, cursor, refresh: 0,
    AbortController, URLSearchParams, Error,
    useEffect: callback => { cleanup = callback(); },
    fetch,
    setLoading: value => writes.loading.push(value),
    setError: value => writes.errors.push(value),
    setPage: value => writes.page.push(value),
    setSelectedStoreId: value => writes.selected.push(value),
  });
  return { cleanup, writes };
}

const store = (id, relationModel = "INDEPENDENT_STORE") => ({
  id, relationModel, name: "متجر تجريبي", partnerActorId: "partner-a",
  publicationState: "unpublished", version: 1,
});
const successResponse = (stores, nextCursor = "") => ({
  status: 200, ok: true,
  json: async () => ({ stores, nextCursor }),
});
const flush = () => new Promise(resolve => setImmediate(resolve));

test("operator registry is keyed to the complete Identity session and requires partner permission", () => {
  assert.match(source, /const \{ state \} = useSession\(\)/);
  assert.match(source, /state\.kind !== "authenticated" \|\| state\.identity\.role !== "operator" \|\| !state\.identity\.subject \|\| !state\.identity\.sessionId/);
  assert.match(source, /!state\.identity\.permissions\?\.includes\("partners"\)/);
  assert.match(source, /JSON\.stringify\(\[state\.identity\.subject, state\.identity\.sessionId\]\)/);
  assert.match(source, /<IndependentStoresRegistry key=\{sessionKey\}/);
  const key = (subject, session) => JSON.stringify([subject, session]);
  assert.notEqual(key("operator-a", "session-1"), key("operator-a", "session-2"));
  assert.notEqual(key("operator-a", "session-1"), key("operator-b", "session-1"));
});

test("registry GET from prior operator cannot publish late owner rows after session unmount", async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  let sentSignal;
  const read = simulateRead((_url, options) => {
    sentSignal = options.signal;
    return pending;
  });
  assert.equal(read.writes.page[0], null);
  assert.equal(read.writes.loading[0], true);
  read.cleanup();
  assert.equal(sentSignal.aborted, true);
  deliver(successResponse([store("private-store")]));
  await flush();
  assert.deepEqual(read.writes.page, [null], "no old private rows after old session unmount");
  assert.deepEqual(read.writes.errors, [""], "no stale error banner after old session unmount");
  assert.deepEqual(read.writes.loading, [true], "old completion cannot change new loading state");
});

test("same-session valid independent Store response is displayed but marketplace Store response is rejected", async () => {
  const valid = simulateRead(async () => successResponse([store("independent")]));
  await flush();
  assert.equal(valid.writes.page.length, 2);
  assert.equal(valid.writes.page[1].stores[0].id, "independent");
  assert.equal(valid.writes.loading.at(-1), false);

  const invalid = simulateRead(async () => successResponse([store("market", "BTHWANI_PARTNER")]));
  await flush();
  assert.deepEqual(invalid.writes.page, [null]);
  assert.match(invalid.writes.errors.at(-1), /غير متطابقة مع DSH/);
});

test("operator 401 and 403 responses fail closed and explain access recovery", async () => {
  for (const [status, expected] of [[401, /انتهت جلسة المشغّل/], [403, /لا تملك صلاحية/]]) {
    const run = simulateRead(async () => ({ status, ok: false }));
    await flush();
    assert.deepEqual(run.writes.page, [null]);
    assert.match(run.writes.errors.at(-1), expected);
  }
});

test("malformed independent Store rows, duplicate IDs and invalid cursor fail closed on 200", async () => {
  const examples = [
    { stores: [null] },
    { stores: [{ ...store(""), name: "متجر" }] },
    { stores: [{ ...store("valid"), partnerActorId: "" }] },
    { stores: [{ ...store("valid"), name: "" }] },
    { stores: [{ ...store("valid"), version: 0 }] },
    { stores: [{ ...store("valid"), publicationState: "published" }] },
    { stores: [store("duplicate"), store("duplicate")] },
    { stores: [store("valid")], nextCursor: 47 },
    { stores: [store("valid")], nextCursor: "x".repeat(1025) },
    { stores: Array.from({ length: 26 }, (_, index) => store("store-" + index)) },
  ];
  for (const page of examples) {
    const run = simulateRead(async () => ({ status: 200, ok: true, json: async () => page }));
    await flush();
    assert.deepEqual(run.writes.page, [null], "invalid DSH page cannot become visible");
    assert.match(run.writes.errors.at(-1), /غير متطابقة مع DSH/);
    assert.deepEqual(run.writes.selected, [""], "private selected Store closes on invalid readback");
    assert.equal(run.writes.loading.at(-1), false);
  }
});

test("valid cursor survives canonical independent Store read while denied session closes selected detail", async () => {
  const allowed = simulateRead(async () => successResponse([store("owned")], "next-page"));
  await flush();
  assert.equal(allowed.writes.page.at(-1).nextCursor, "next-page");
  assert.deepEqual(allowed.writes.selected, []);
  const denied = simulateRead(async () => ({ status: 403, ok: false }));
  await flush();
  assert.deepEqual(denied.writes.selected, [""]);
  assert.deepEqual(denied.writes.page, [null]);
});

test("query, filter and cursor changes clear the previously selected Store before reusing row state", () => {
  assert.match(source, /setSelectedStoreId\(""\);\s*setHistory\(\[\]\);\s*setCursor\(""\);\s*setQuery/);
  assert.match(source, /setSelectedStoreId\(""\);\s*setState\(event\.target\.value as PublicationFilter\)/);
  assert.match(source, /setSelectedStoreId\(""\);\s*setCursor\(history\[history\.length - 1\]/);
  assert.match(source, /setSelectedStoreId\(""\);\s*setHistory\(\(old\) => \[\.\.\.old, cursor\]\)/);
});
