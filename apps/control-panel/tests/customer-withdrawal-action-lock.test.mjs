import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/finance/customer-withdrawal-queue.tsx", import.meta.url), "utf8");
const begin = source.indexOf("  const mutationHeaders = (scope: string) => {");
const end = source.indexOf("\n  const intake = detail?.intake;", begin);
assert.ok(begin >= 0 && end > begin, "read the actual Control Finance action callbacks");
const runnable = source.slice(begin, end)
  .replace("const mutationHeaders = (scope: string)", "const mutationHeaders = (scope)")
  .replace("const completeMutation = (scope: string)", "const completeMutation = (scope)")
  .replace(/const act = async \(action: [^)]*\)/, "const act = async (action)")
  .replace('const transitionPayout = async (action: "prepare" | "approve")', "const transitionPayout = async (action)")
  .replace('json<{ batch: { id: string; rowCount: number; totalAmountMinor: number; currency: "YER" } }>', "json");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const initialIntake = {
  id: "intake-a", payoutId: "payout-a", payoutStatus: "APPROVED", status: "PAYOUT_HELD",
};

function queue(fetchImpl, overrides = {}) {
  const pendingMutations = { current: new Map() };
  const mutationInFlight = { current: false };
  const requests = [], changes = [], navigations = [];
  let activeNotice = "", activeError = "";
  let serial = 0;
  const ctx = {
    pendingMutations, mutationInFlight,
    detail: { intake: { ...initialIntake, ...overrides.intake } },
    reason: overrides.reason ?? "Approved reason",
    verificationEvidence: overrides.verificationEvidence ?? "verified reference",
    payoutEvidenceReference: overrides.payoutEvidenceReference ?? "payout evidence",
    initialQuery: { intakeId: "intake-a", search: "", status: "", sort: "requested_desc", cursor: "" },
    crypto: { randomUUID: () => `finance-key-${++serial}` },
    router: { push: (path) => navigations.push(path) },
    AbortController,
    encodeURIComponent,
    JSON, Map,
    fetch: (path, options) => { requests.push({ path, options }); return fetchImpl(path, options); },
    json: async (response, fallback) => {
      if (!response.ok) throw new Error(fallback);
      return response.payload ?? {};
    },
    setDetailError: (value) => { activeError = value; changes.push(["error", value]); },
    setNotice: (value) => { activeNotice = value; changes.push(["notice", value]); },
    setLoading: (value) => changes.push(["loading", value]),
    setReason: (value) => changes.push(["reason", value]),
    setVerificationEvidence: (value) => changes.push(["verificationEvidence", value]),
    setPayoutEvidenceReference: (value) => changes.push(["payoutEvidenceReference", value]),
    loadDetail: async (id) => changes.push(["loadDetail", id]),
    loadRegistry: async () => changes.push(["loadRegistry"]),
  };
  const operations = runInNewContext(`${runnable}\n({act,transitionPayout,createPayoutBatch});`, ctx);
  return { ...operations, pendingMutations, mutationInFlight, requests, changes, navigations,
    get notice() { return activeNotice; },
    get error() { return activeError; },
  };
}

test("customer withdrawal accept and contradictory reject cannot POST in the same turn", async () => {
  const post = deferred();
  const q = queue(() => post.promise);
  const accepted = q.act("accept");
  const duplicate = q.act("accept");
  const rejection = q.act("reject");
  assert.equal(q.requests.length, 1);
  assert.equal(q.mutationInFlight.current, true);
  assert.match(q.requests[0].path, /intake-a\/accept$/);
  post.resolve({ ok: true });
  await Promise.all([accepted, duplicate, rejection]);
  assert.equal(q.requests.length, 1);
  assert.equal(q.mutationInFlight.current, false);
  assert.equal(q.pendingMutations.current.size, 0);
  assert.match(q.notice, /حُفظ الإجراء/);
  assert.equal(q.changes.filter(([name]) => name === "loadDetail").length, 1);
});

test("payout prepare and approve cannot be submitted concurrently by two rapid clicks", async () => {
  const post = deferred();
  const q = queue(() => post.promise);
  const first = q.transitionPayout("prepare");
  const approve = q.transitionPayout("approve");
  const alsoAccept = q.act("accept");
  assert.equal(q.requests.length, 1);
  assert.match(q.requests[0].path, /payout-a\/prepare$/);
  post.resolve({ ok: true });
  await Promise.all([first, approve, alsoAccept]);
  assert.equal(q.mutationInFlight.current, false);
});

test("batch creation and payout approval share the same synchronous in-flight lock", async () => {
  const post = deferred();
  const q = queue(() => post.promise);
  const batch = q.createPayoutBatch();
  const approval = q.transitionPayout("approve");
  const secondBatch = q.createPayoutBatch();
  assert.equal(q.requests.length, 1);
  assert.match(q.requests[0].path, /\/api\/finance\/settlement-batches$/);
  post.resolve({ ok: true, payload: { batch: { id: "batch-a" } } });
  await Promise.all([batch, approval, secondBatch]);
  assert.equal(q.navigations.length, 1);
  assert.match(q.navigations[0], /batchId=batch-a/);
  assert.equal(q.pendingMutations.current.size, 0);
  assert.equal(q.mutationInFlight.current, false);
});

test("unknown POST result retains the identical idempotency and correlation identifiers on retry", async () => {
  const post = deferred();
  let next = true;
  const q = queue(() => next ? post.promise : Promise.resolve({ ok: true }));
  const first = q.act("accept");
  assert.equal(q.pendingMutations.current.size, 1);
  post.reject(new Error("transport lost"));
  await first;
  assert.equal(q.mutationInFlight.current, false);
  assert.equal(q.pendingMutations.current.size, 1);
  assert.equal(q.notice, "");
  next = false;
  await q.act("accept");
  assert.equal(q.requests.length, 2);
  assert.equal(q.requests[0].options.headers["Idempotency-Key"], q.requests[1].options.headers["Idempotency-Key"]);
  assert.equal(q.requests[0].options.headers["X-Correlation-ID"], q.requests[1].options.headers["X-Correlation-ID"]);
  assert.equal(q.pendingMutations.current.size, 0);
});

test("failed batch creation does not claim success and later attempt may resume the original key", async () => {
  let fail = true;
  const q = queue(() => Promise.resolve(fail ? { ok: false } : { ok: true, payload: { batch: { id: "batch-b" } } }));
  await q.createPayoutBatch();
  assert.equal(q.navigations.length, 0);
  assert.equal(q.pendingMutations.current.size, 1);
  assert.equal(q.mutationInFlight.current, false);
  fail = false;
  await q.createPayoutBatch();
  assert.equal(q.navigations.length, 1);
  assert.equal(q.requests[0].options.headers["Idempotency-Key"], q.requests[1].options.headers["Idempotency-Key"]);
});

test("validation failures never acquire the lock or send financially consequential operations", async () => {
  const q = queue(() => { throw new Error("not called"); }, { reason: " " });
  await q.act("accept");
  await q.transitionPayout("prepare");
  assert.equal(q.requests.length, 0);
  assert.equal(q.mutationInFlight.current, false);
  const another = queue(() => { throw new Error("not called"); }, { verificationEvidence: " " });
  await another.act("verify-destination");
  assert.equal(another.requests.length, 0);
  assert.equal(another.mutationInFlight.current, false);
});

test("all finance mutations check and release the same synchronous lock", () => {
  assert.match(source, /const mutationInFlight = useRef\(false\)/);
  assert.match(source, /if \(!intake \|\| mutationInFlight\.current\) return/);
  assert.match(source, /if \(!intake\?\.payoutId \|\| mutationInFlight\.current\) return/);
  assert.match(source, /detail\?\.intake\.payoutStatus !== "APPROVED" \|\| mutationInFlight\.current/);
  assert.equal(source.match(/mutationInFlight\.current = true/g)?.length, 3);
  assert.equal(source.match(/mutationInFlight\.current = false/g)?.length, 3);
});
