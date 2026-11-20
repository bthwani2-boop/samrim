import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../../services/dsh/clients/index.ts";

const base = "http://127.0.0.1:3202";
const bearer = "A".repeat(43);
const standing = { actorId: "captain-a", status: "PENDING", version: 2 };
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
const rejects = (operation, status, code) => assert.rejects(operation,
  error => error instanceof sdk.DshPublicError && error.status === status && error.code === code);
async function withFetch(callback, run) {
  const previous = globalThis.fetch; globalThis.fetch = callback;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test("Operator Captain queue uses only the current bearer and fixed bounded owner read", async () => {
  assert.equal(typeof sdk.listOperatorCaptainStandings, "function");
  const controller = new AbortController();
  await withFetch(async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, base);
    assert.equal(target.pathname, "/v1/operators/captains");
    assert.deepEqual([...target.searchParams], [["status", "PENDING"], ["limit", "2"], ["cursor", "next-page"]]);
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert.equal(options.signal, controller.signal);
    return json({ items: [standing], nextCursor: "page-3" });
  }, async () => assert.deepEqual(await sdk.listOperatorCaptainStandings(base, bearer,
    { status: "PENDING", limit: 2, cursor: "next-page", signal: controller.signal }), { items: [standing], nextCursor: "page-3" }));
});

test("Captain queue validates filters, limit and opaque cursor before any owner request", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({ items: [] }); }, async () => {
    for (const options of [{ status: "pending" }, { status: "ALL" }, { limit: 0 }, { limit: 51 }, { limit: 1.5 },
      { cursor: "" }, { cursor: "a".repeat(513) }, { cursor: "../private" }, { cursor: "é" }]) {
      await rejects(() => sdk.listOperatorCaptainStandings(base, bearer, options), 400, "INVALID_REQUEST");
    }
  });
  assert.equal(calls, 0);
});

test("Captain detail preserves the selected actor including valid UTF-8 IDs", async () => {
  for (const actorId of ["captain-a", "ت".repeat(64), "😀".repeat(32)]) {
    await withFetch(async url => {
      assert.equal(new URL(url).pathname, `/v1/operators/captains/${encodeURIComponent(actorId)}/standing`);
      return json({ ...standing, actorId });
    }, async () => assert.equal((await sdk.getOperatorCaptainStanding(base, actorId, bearer)).actorId, actorId));
  }
});

test("Captain detail rejects traversal, invalid Unicode and actor IDs exceeding 128 UTF-8 bytes", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json(standing); }, async () => {
    for (const actorId of ["", ".", "..", "a/b", "a\\b", " a", "a ", "a\u0000b", "a\nb", "\ud800", "ت".repeat(65), "😀".repeat(33)]) {
      await rejects(() => sdk.getOperatorCaptainStanding(base, actorId, bearer), 400, "INVALID_REQUEST");
    }
  });
  assert.equal(calls, 0);
});

test("Captain queue and detail reject owner privacy leaks, scope mismatches and malformed versions", async () => {
  for (const item of [{ ...standing, phone: "private" }, { ...standing, reason: "private" },
    { ...standing, status: "APPROVED" }, { ...standing, version: 0 }, { ...standing, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...standing, actorId: ".." }]) {
    await withFetch(async () => json({ items: [item] }), () => rejects(
      () => sdk.listOperatorCaptainStandings(base, bearer, { status: "PENDING" }), 502, "OWNER_RESPONSE_INVALID"));
  }
  for (const page of [{ items: [standing, standing] }, { items: [], nextCursor: "" },
    { items: Array.from({ length: 21 }, (_, index) => ({ ...standing, actorId: `captain-${index}` })) },
    { items: [], privateNote: "secret" }]) {
    await withFetch(async () => json(page), () => rejects(
      () => sdk.listOperatorCaptainStandings(base, bearer), 502, "OWNER_RESPONSE_INVALID"));
  }
  await withFetch(async () => json({ ...standing, actorId: "captain-b" }), () => rejects(
    () => sdk.getOperatorCaptainStanding(base, standing.actorId, bearer), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => json({ ...standing, privateAudit: "x" }), () => rejects(
    () => sdk.getOperatorCaptainStanding(base, standing.actorId, bearer), 502, "OWNER_RESPONSE_INVALID"));
});

test("Captain owner failures preserve their fixed contract codes and never echo owner details", async () => {
  for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [503, "OWNER_UNAVAILABLE"]]) {
    await withFetch(async () => json({ error: code, detail: "private" }, status), () => rejects(
      () => sdk.getOperatorCaptainStanding(base, standing.actorId, bearer), status, code));
  }
});

test("oversized Captain readback and cancelled late responses fail closed", async () => {
  await withFetch(async () => json({ items: [], padding: "x".repeat(32769) }), () => rejects(
    () => sdk.listOperatorCaptainStandings(base, bearer), 502, "OWNER_RESPONSE_INVALID"));
  const controller = new AbortController();
  await withFetch(async () => { controller.abort(); return json({ items: [standing] }); }, () => rejects(
    () => sdk.listOperatorCaptainStandings(base, bearer, { signal: controller.signal }), 0, "OWNER_RESPONSE_STALE"));
});
