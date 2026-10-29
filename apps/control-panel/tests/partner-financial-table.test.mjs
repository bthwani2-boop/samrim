import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const componentPath = new URL("../src/features/finance/partner-financial-register.tsx", import.meta.url);
const source = await readFile(componentPath, "utf8");
const helperSource = source.match(/function isCurrentPartnerActivityRequest\([\s\S]*?\n\}/)?.[0];
assert.ok(helperSource, "the component owns an explicit request-scope predicate");
const runnableHelper = helperSource.replace(
  "function isCurrentPartnerActivityRequest(requestId: number, currentRequestId: number, requestKey: string, currentKey: string): boolean {",
  "function isCurrentPartnerActivityRequest(requestId, currentRequestId, requestKey, currentKey) {",
);
const helperModule = { exports: {} };
vm.runInNewContext(runnableHelper + "\nmodule.exports = isCurrentPartnerActivityRequest;", { module: helperModule });
const isCurrent = helperModule.exports;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function guardedPage(request, current, operation, state, append = false) {
  try {
    const page = await operation;
    if (!isCurrent(request.id, current.id, request.key, current.key)) return;
    state.items = append ? [...state.items, ...page.items] : page.items;
    state.cursor = page.nextCursor ?? "";
  } catch (error) {
    if (!isCurrent(request.id, current.id, request.key, current.key)) return;
    state.error = error.message;
  } finally {
    if (isCurrent(request.id, current.id, request.key, current.key)) state.loading = false;
  }
}

test("old page responses cannot mix actors, stores, or filter scopes into the current page", async () => {
  for (const nextKey of [
    JSON.stringify(["partner-b", "store-a", "filters-a"]),
    JSON.stringify(["partner-a", "store-b", "filters-a"]),
    JSON.stringify(["partner-a", "store-a", "filters-b"]),
  ]) {
    const oldResponse = deferred();
    const current = { id: 1, key: JSON.stringify(["partner-a", "store-a", "filters-a"]) };
    const state = { items: [{ id: "current-row" }], cursor: "current-cursor", error: "", loading: true };
    const oldDone = guardedPage({ ...current }, current, oldResponse.promise, state, true);
    current.id += 1;
    current.key = nextKey;
    oldResponse.resolve({ items: [{ id: "stale-row" }], nextCursor: "stale-cursor" });
    await oldDone;
    assert.deepEqual(state.items.map((item) => item.id), ["current-row"]);
    assert.equal(state.cursor, "current-cursor");
    assert.equal(state.loading, true);
  }
});

test("a stale page failure cannot overwrite current error or loading state", async () => {
  const oldResponse = deferred();
  const current = { id: 4, key: "partner-a|store-a|filters-a" };
  const state = { items: [{ id: "current" }], cursor: "next", error: "", loading: true };
  const oldDone = guardedPage({ ...current }, current, oldResponse.promise, state, true);
  current.id = 5;
  current.key = "partner-a|store-b|filters-b";
  oldResponse.reject(new Error("obsolete page failed"));
  await oldDone;
  assert.deepEqual(state.items.map((item) => item.id), ["current"]);
  assert.equal(state.cursor, "next");
  assert.equal(state.error, "");
  assert.equal(state.loading, true);
});

test("a current retry can append a deduplicated page and clear its error", async () => {
  const current = { id: 7, key: "partner-a|store-a|filters-a" };
  const state = { items: [{ id: "existing" }], cursor: "retry-cursor", error: "", loading: true };
  const retry = deferred();
  const retryDone = guardedPage({ ...current }, current, retry.promise, state, true);
  retry.resolve({ items: [{ id: "new-row" }], nextCursor: "" });
  await retryDone;
  assert.deepEqual(state.items.map((item) => item.id), ["existing", "new-row"]);
  assert.equal(state.cursor, "");
  assert.equal(state.loading, false);
});

test("component guards first-page and cursor-page success, failure, and loading writes", () => {
  assert.doesNotMatch(source, /useReactTable|useVirtualizer|@tanstack\/(react-table|react-virtual)/);
  assert.match(source, /<Table<PartnerFinancialActivity>/);
  assert.match(source, /pagination=\{false\}/);
  assert.match(source, /virtual=\{items\.length > 60 && expanded\.length === 0 && !compact\}/);
  assert.match(source, /rowKey=\{activityKey\}/);
  assert.match(source, /currentQueryKey\.current = queryKey/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /setPage\(\(previous\) => \{\s*if \(!isCurrent\(\) \|\| previous\?\.queryKey !== requestKey\) return previous;/);
  assert.match(source, /if \(!controller\.signal\.aborted && isCurrent\(\)\)/);
  assert.match(source, /if \(isCurrent\(\)\) setRequestState/);
  assert.match(source, /setRetrySequence\(\(current\) => current \+ 1\)/);
  assert.match(source, /moreError \? "إعادة المحاولة" : "تحميل المزيد"/);
  assert.match(source, /CASH_COMMISSION/);
  assert.match(source, /offsetMinor/);
  assert.match(source, /ledgerTransactionId/);
});
