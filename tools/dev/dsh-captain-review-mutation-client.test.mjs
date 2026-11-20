import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../../services/dsh/clients/index.ts";

const base = "http://127.0.0.1:3202";
const bearer = "A".repeat(43);
const actorId = "captain-a";
const change = { status: "APPROVED", expectedVersion: 2, operationId: "op-captain-12345", reason: "Reviewed documents" };
const standing = { actorId, status: "APPROVED", version: 3 };

async function withFetch(callback, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = callback;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

const rejects = (run, status, code) => assert.rejects(run,
  error => error instanceof sdk.DshPublicError && error.status === status && error.code === code);

test("Captain review mutation forwards exact versioned decision to DSH with current bearer", async () => {
  const abort = new AbortController();
  await withFetch(async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, base);
    assert.equal(target.pathname, "/v1/operators/captains/captain-a/standing");
    assert.equal(options.method, "PATCH");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.signal, abort.signal);
    assert.deepEqual(JSON.parse(options.body), change);
    return Response.json(standing);
  }, async () => assert.deepEqual(
    await sdk.changeOperatorCaptainStanding(base, actorId, bearer, change, abort.signal), standing));
});

test("Captain review mutation refuses invalid actor, status, version, operation key or audit reason without network", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return Response.json(standing); }, async () => {
    for (const [actor, payload] of [
      ["../captain", change],
      [actorId, { ...change, status: "PENDING" }],
      [actorId, { ...change, expectedVersion: 0 }],
      [actorId, { ...change, expectedVersion: 1.5 }],
      [actorId, { ...change, operationId: "short" }],
      [actorId, { ...change, operationId: "a".repeat(129) }],
      [actorId, { ...change, reason: "" }],
      [actorId, { ...change, reason: " x" }],
      [actorId, { ...change, reason: "x".repeat(301) }],
    ]) {
      await rejects(() => sdk.changeOperatorCaptainStanding(base, actor, bearer, payload), 400, "INVALID_REQUEST");
    }
  });
  assert.equal(calls, 0);
});

test("Captain review mutation treats uncertain owner replies as unknown outcomes, never success", async () => {
  for (const result of [
    { ...standing, actorId: "another" },
    { ...standing, reason: "sensitive" },
    { ...standing, version: 0 },
    { ...standing, status: "WRONG" },
  ]) {
    await withFetch(async () => Response.json(result), () =>
      rejects(() => sdk.changeOperatorCaptainStanding(base, actorId, bearer, change), 502, "OPERATION_RESULT_UNKNOWN"));
  }
  await withFetch(async () => { throw new TypeError("Connection lost after submission"); }, () =>
    rejects(() => sdk.changeOperatorCaptainStanding(base, actorId, bearer, change), 0, "OPERATION_RESULT_UNKNOWN"));
  await withFetch(async () => Response.json({ error: "retry" }, { status: 503 }), () =>
    rejects(() => sdk.changeOperatorCaptainStanding(base, actorId, bearer, change), 503, "OPERATION_RESULT_UNKNOWN"));
});

test("Captain review mutation surfaces owner conflict without mutating or retrying itself", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return Response.json({ error: "CAPTAIN_STANDING_VERSION_CONFLICT" }, { status: 409 });
  }, async () => rejects(() => sdk.changeOperatorCaptainStanding(base, actorId, bearer, change),
    409, "CAPTAIN_STANDING_VERSION_CONFLICT"));
  assert.equal(calls, 1);
});
