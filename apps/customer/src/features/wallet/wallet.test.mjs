import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCustomerFundingHistory, readCurrentCustomerWalletTransactions, WltReadError } from "@bthwani/wlt";
import { readVerifiedWallet, readVerifiedWalletTransactions } from "./wallet-read.web.ts";

test("Native wallet shows only verified WLT reads; Cash-In remains unavailable", () => {
  const native = readFileSync(new URL("wallet-screen.tsx", import.meta.url), "utf8");
  assert.match(native, /readNativeWallet\(/);
  assert.match(native, /readNativeWalletTransactions\(/);
  assert.doesNotMatch(native, /fetch\(|credit\(|debit\(/);
  const funding = readFileSync(new URL("cash-in-panel.tsx", import.meta.url), "utf8");
  assert.match(funding, /CapabilityUnavailableScreen/);
  assert.doesNotMatch(funding, /fetch\(|credit\(|debit\(/);
});

const amount = "9007199254741050";
const live = actorId => ({ enabled: true, session: {
  actorId, role: "customer", sessionExpiresAt: new Date(Date.now() + 60000).toISOString(),
} });

test("wallet projection preserves exact YER and binds the response to the current actor twice", async (t) => {
  t.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(path, "/api/customer-auth/wallet");
    assert.equal(options.credentials, "same-origin");
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
      { headers: { "Cache-Control": "no-store" } });
  });
  let reads = 0;
  const admission = async () => {
    reads++;
    return live("actor-a");
  };
  const result = await readVerifiedWallet(admission, new AbortController().signal);
  assert.equal(reads, 2);
  assert.equal(result.kind, "ready");
  assert.equal(result.balance.balanceYer, amount);
});

test("checkout balance rejects a different current Customer before fetching WLT", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("a stale cart must not fetch another Customer balance");
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await readVerifiedWallet(async () => live("actor-b"), signal, "actor-a"),
    { kind: "signed-out" });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("a changed account after the wallet response cannot display the previous balance", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
      { headers: { "Cache-Control": "no-store" } }));
  const sessions = [live("actor-a"), live("actor-b")];
  const result = await readVerifiedWallet(async () => sessions.shift(), new AbortController().signal);
  assert.deepEqual(result, { kind: "signed-out" });
});

test("a different role or expired Customer session cannot initiate a wallet read", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("rejected admission must not request the financial balance");
  });
  const signal = new AbortController().signal;
  const merchant = { ...live("actor-a"), session: { ...live("actor-a").session, role: "merchant" } };
  assert.deepEqual(await readVerifiedWallet(async () => merchant, signal), { kind: "signed-out" });
  const expired = { ...live("actor-a"), session: {
    ...live("actor-a").session, sessionExpiresAt: new Date(Date.now() - 1000).toISOString(),
  } };
  assert.deepEqual(await readVerifiedWallet(async () => expired, signal), { kind: "signed-out" });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("a role switch for the same Identity actor discards the pending wallet balance", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
      { headers: { "Cache-Control": "no-store" } }));
  const customer = live("actor-a");
  const merchant = { ...customer, session: { ...customer.session, role: "merchant" } };
  const states = [customer, merchant];
  const result = await readVerifiedWallet(async () => states.shift(), new AbortController().signal);
  assert.deepEqual(result, { kind: "signed-out" });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("a wallet response after cancellation is discarded", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
      { headers: { "Cache-Control": "no-store" } });
  });
  await assert.rejects(() => readVerifiedWallet(async () => live("actor-a"), controller.signal),
    { name: "AbortError" });
});

test("the Web wallet route uses only the isolated loopback owner and the existing HttpOnly session", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "http://127.0.0.1:3203/v1/wallets/me");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + Buffer.alloc(32, 17).toString("base64url"));
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
      { headers: { "Cache-Control": "no-store" } });
  });
  const saved = [process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW, process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN, process.env.BTHWANI_ISOLATED_TEST_MODE];
  t.after(() => {
    const names = ["BTHWANI_DOCKER_WALLET_WEB_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN", "BTHWANI_ISOLATED_TEST_MODE"];
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  });
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const { GET } = await import("../../../app/api/customer-auth/wallet+api.ts");
  const path = "http://127.0.0.1:18101/api/customer-auth/wallet";
  const headers = { Cookie: "bthwani_customer_auth=" + Buffer.alloc(32, 17).toString("base64url") };
  assert.equal((await GET(new Request(path))).status, 401);
  assert.equal((await GET(new Request(path + "?actorId=other", { headers }))).status, 400);
  assert.equal((await GET(new Request(path, { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const shown = await GET(new Request(path, { headers }));
  assert.equal(shown.headers.get("Cache-Control"), "no-store");
  assert.equal((await shown.json()).balanceYer, amount);
  delete process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW;
  assert.equal((await GET(new Request(path, { headers }))).status, 503);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

const history = {
  actorId: "actor-a", currency: "YER", hasMore: false, nextCursor: null,
  items: [{ fundingId: "funding-0001", amountYer: amount, postedAt: "2026-11-20T00:00:00Z" }],
};

test("Web wallet rejects invalid session expiry without requesting financial data", async t => {
  const invalid = live("actor-a");
  invalid.session.sessionExpiresAt = "invalid";
  t.mock.method(globalThis, "fetch", async () => Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount },
    { headers: { "Cache-Control": "no-store" } }));
  assert.deepEqual(await readVerifiedWallet(async () => invalid, new AbortController().signal), { kind: "signed-out" });
  assert.deepEqual(await readVerifiedWalletTransactions(async () => invalid, new AbortController().signal), { kind: "signed-out" });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("Web balance and history reject non-JSON and oversized owner evidence using the existing owner limits", async t => {
  const balance = { actorId: "actor-a", currency: "YER", balanceYer: amount, availableYer: amount };
  const replies = [];
  t.mock.method(globalThis, "fetch", async () => replies.shift());
  for (const [value, limit, read] of [[balance, 4096, readVerifiedWallet], [history, 8192, readVerifiedWalletTransactions]]) {
    for (const response of [
      new Response(JSON.stringify(value), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }),
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Content-Length": String(limit + 1), "Cache-Control": "no-store" } }),
      new Response(JSON.stringify(value) + " ".repeat(limit + 1), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }),
    ]) {
      replies.push(response);
      await assert.rejects(read(async () => live("actor-a"), new AbortController().signal), { name: "WltReadError", status: 502 });
    }
    replies.push(Response.json(value, { headers: { "Cache-Control": "no-store" } }));
    assert.equal((await read(async () => live("actor-a"), new AbortController().signal)).kind, "ready");
  }
});

test("Web wallet releases rejected and cancelled response bodies without revealing financial values", async t => {
  const replies = [];
  t.mock.method(globalThis, "fetch", async () => replies.shift());
  for (const [status, cache, kind] of [[401, "no-store", "signed-out"], [403, "no-store", "signed-out"], [503, "no-store", "unavailable"], [200, "public", "unavailable"]]) {
    let cancelled = false;
    replies.push(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { "Cache-Control": cache } }));
    assert.deepEqual(await readVerifiedWallet(async () => live("actor-a"), new AbortController().signal), { kind });
    assert.equal(cancelled, true);
  }
});

test("Web history abort interrupts a stalled response and a fresh read can recover", async t => {
  const ctl = new AbortController();
  let stream, cancelled = false, timer;
  const replies = [new Response(new ReadableStream({
    start(c) { stream = c; },
    cancel() { cancelled = true; },
  }), { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } })];
  t.mock.method(globalThis, "fetch", async () => replies.shift());
  const pending = readVerifiedWalletTransactions(async () => live("actor-a"), ctl.signal)
    .then(() => "UNEXPECTED", error => error.name);
  try {
    await new Promise(resolve => setImmediate(resolve));
    ctl.abort();
    assert.equal(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 500); })]), "AbortError");
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
    if (!cancelled) stream.close();
    await pending;
  }
  replies.push(Response.json(history, { headers: { "Cache-Control": "no-store" } }));
  const fresh = await readVerifiedWalletTransactions(async () => live("actor-a"), new AbortController().signal);
  assert.equal(fresh.kind, "ready");
  assert.deepEqual(fresh.history, history);
});

test("funding history rejects provider details, other actors, non-integer money and invalid time", () => {
  assert.deepEqual(parseCustomerFundingHistory(history), history);
  for (const invalid of [
    { ...history, providerReference: "secret" },
    { ...history, items: [{ ...history.items[0], providerReference: "secret" }] },
    { ...history, items: [{ ...history.items[0], amountYer: "0" }] },
    { ...history, items: [{ ...history.items[0], amountYer: "1.1" }] },
    { ...history, items: [{ ...history.items[0], postedAt: "not-a-time" }] },
    { ...history, items: Array(11).fill(history.items[0]) },
  ]) {
    assert.throws(() => parseCustomerFundingHistory(invalid), WltReadError);
  }
});

test("funding history identifies a debit by its original posting and keeps legacy credits", () => {
  const reversal = { fundingId: "sandbox_reversal-example", amountYer: amount,
    postedAt: "2026-11-21T00:00:00Z", reversesFundingId: "funding-0001" };
  const result = { ...history, items: [reversal, ...history.items] };
  assert.deepEqual(parseCustomerFundingHistory(result), result);
  for (const id of [null, "short", reversal.fundingId]) {
    assert.throws(() => parseCustomerFundingHistory({
      ...history, items: [{ ...reversal, reversesFundingId: id }],
    }), WltReadError);
  }
});

test("WLT funding SDK rejects duplicate, out-of-order and invalid calendar entries", () => {
  const newer = { fundingId: "funding-0002", amountYer: "15",
    postedAt: "2026-11-20T01:00:00.100000001Z" };
  const older = { fundingId: "funding-0001", amountYer: "10",
    postedAt: "2026-11-20T01:00:00.1Z" };
  const valid = { ...history, items: [newer, older] };
  assert.deepEqual(parseCustomerFundingHistory(valid), valid);
  for (const invalid of [
    { ...valid, items: [newer, newer] },
    { ...valid, items: [older, newer] },
    { ...valid, items: [older, { ...newer, fundingId: "funding-0003" }] },
    { ...history, items: [{ ...history.items[0], postedAt: "2026-02-30T00:00:00Z" }] },
  ]) {
    assert.throws(() => parseCustomerFundingHistory(invalid), WltReadError);
  }
});

test("WLT funding keyset orders equal-time entries by descending funding ID", () => {
  const newerId = { fundingId: "funding-0002", amountYer: "10",
    postedAt: "2026-11-20T01:00:00Z" };
  const olderId = { fundingId: "funding-0001", amountYer: "11",
    postedAt: "2026-11-20T01:00:00.000000000Z" };
  assert.deepEqual(parseCustomerFundingHistory({ ...history, items: [newerId, olderId] }),
    { ...history, items: [newerId, olderId] });
  assert.throws(() => parseCustomerFundingHistory({ ...history, items: [olderId, newerId] }),
    WltReadError);
  const lowerId = { ...olderId, fundingId: "funding-page-03" };
  const mixedCase = { ...olderId, fundingId: "funding-PAGE-03" };
  assert.deepEqual(parseCustomerFundingHistory({ ...history, items: [lowerId, mixedCase] }),
    { ...history, items: [lowerId, mixedCase] });
  assert.throws(() => parseCustomerFundingHistory({ ...history, items: [mixedCase, lowerId] }),
    WltReadError);
});

test("funding history is tied to the current Customer before and after owner read", async (t) => {
  let admissions = 0;
  t.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(path, "/api/customer-auth/wallet-transactions");
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "same-origin");
    return Response.json(history, { headers: { "Cache-Control": "no-store" } });
  });
  const result = await readVerifiedWalletTransactions(async () => {
    admissions++;
    return live("actor-a");
  }, new AbortController().signal);
  assert.equal(admissions, 2);
  assert.equal(result.kind, "ready");
  assert.equal(result.history.items[0].amountYer, amount);
});

test("funding history cannot survive a role or actor switch after the HTTP read", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(history, { headers: { "Cache-Control": "no-store" } }));
  const first = live("actor-a");
  const merchant = { ...first, session: { ...first.session, role: "merchant" } };
  for (const next of [merchant, live("actor-b")]) {
    const responses = [first, next];
    assert.deepEqual(await readVerifiedWalletTransactions(
      async () => responses.shift(), new AbortController().signal,
    ), { kind: "signed-out" });
  }
});

test("WLT funding history SDK uses only the isolated owner operation", async (t) => {
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "http://127.0.0.1:3203/v1/wallets/me/transactions");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return Response.json(history, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:3203", bearer, new AbortController().signal,
  ), history);
  await assert.rejects(() => readCurrentCustomerWalletTransactions(
    "http://attacker.invalid", bearer, new AbortController().signal,
  ), { status: 503 });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("Customer wallet history BFF denies cross-site and arbitrary actor queries", async (t) => {
  const names = ["BTHWANI_DOCKER_WALLET_WEB_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN", "BTHWANI_ISOLATED_TEST_MODE"];
  const saved = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => {
    if (saved[i] === undefined) delete process.env[name];
    else process.env[name] = saved[i];
  }));
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json(history,
    { headers: { "Cache-Control": "no-store" } }));
  const path = "http://127.0.0.1:18101/api/customer-auth/wallet-transactions";
  const headers = { Cookie: `bthwani_customer_auth=${Buffer.alloc(32, 17).toString("base64url")}` };
  assert.equal((await GET(new Request(path))).status, 401);
  assert.equal((await GET(new Request(`${path}?actorId=other`, { headers }))).status, 400);
  assert.equal((await GET(new Request(path, { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const result = await GET(new Request(path, { headers }));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await result.json(), history);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

const nextCursor = Buffer.from("2026-11-20T00:00:00Z|funding-page-00").toString("base64url");
const tenFunding = Array.from({ length: 10 }, (_, index) => ({
  fundingId: `funding-page-${(9 - index).toString().padStart(2, "0")}`,
  amountYer: "1", postedAt: "2026-11-20T00:00:00Z",
}));
const pageOne = {
  actorId: "actor-a", currency: "YER", items: tenFunding, hasMore: true,
  nextCursor,
};

test("WLT funding page envelopes require matching nextCursor and hasMore with a bounded page", () => {
  assert.deepEqual(parseCustomerFundingHistory(pageOne), pageOne);
  for (const invalid of [
    { ...pageOne, hasMore: false },
    { ...pageOne, nextCursor: null },
    { ...pageOne, nextCursor: "?" },
    { ...pageOne, nextCursor: nextCursor + "@" },
    { ...pageOne, nextCursor: Buffer.from("2026-11-20T00:00:00Z|funding-page-08").toString("base64url") },
    { ...pageOne, nextCursor: Buffer.from("2026-11-20T00:00:00Z|another-actor").toString("base64url") },
    { ...pageOne, items: tenFunding.slice(0, 9) },
    { ...history, hasMore: true },
    { ...history, nextCursor },
    { ...history, nextCursor: "x".repeat(241) },
  ]) {
    assert.throws(() => parseCustomerFundingHistory(invalid), WltReadError);
  }
});

const olderItems = tenFunding.map(item => ({ ...item, fundingId: item.fundingId.replace("page", "older"), postedAt: "2026-11-19T00:00:00Z" }));
const pageTwo = {
  ...pageOne, items: olderItems,
  nextCursor: Buffer.from("2026-11-19T00:00:00Z|funding-older-00").toString("base64url"),
};
test("a verified Customer can request an older bounded WLT history page", async (t) => {
  let admissionReads = 0;
  t.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(path, `/api/customer-auth/wallet-transactions?cursor=${nextCursor}`);
    assert.equal(options.credentials, "same-origin");
    return Response.json(pageTwo, { headers: { "Cache-Control": "no-store" } });
  });
  const result = await readVerifiedWalletTransactions(async () => {
    admissionReads++;
    return live("actor-a");
  }, new AbortController().signal, nextCursor, "actor-a");
  assert.equal(admissionReads, 2);
  assert.equal(result.kind, "ready");
  assert.equal(result.history.nextCursor, pageTwo.nextCursor);
});

test("a changed Customer cannot inherit an older wallet history page", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(pageTwo, { headers: { "Cache-Control": "no-store" } }));
  const sessions = [live("actor-a"), live("actor-b")];
  const result = await readVerifiedWalletTransactions(
    async () => sessions.shift(), new AbortController().signal, nextCursor,
  );
  assert.deepEqual(result, { kind: "signed-out" });
});

test("wallet history stays bound to the Customer whose balance is already displayed", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ...pageTwo, actorId: "actor-b" }, { headers: { "Cache-Control": "no-store" } }));
  for (const cursor of [undefined, nextCursor]) {
    const result = await readVerifiedWalletTransactions(
      async () => live("actor-b"), new AbortController().signal, cursor, "actor-a",
    );
    assert.deepEqual(result, { kind: "signed-out" });
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("WLT SDK forwards only a canonical cursor to its isolated owner", async (t) => {
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, `http://127.0.0.1:3203/v1/wallets/me/transactions?cursor=${nextCursor}`);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    return Response.json(pageTwo, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:3203", bearer, new AbortController().signal, nextCursor,
  ), pageTwo);
  await assert.rejects(() => readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:3203", bearer, new AbortController().signal, "invalid",
  ), { status: 400 });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("WLT SDK and Customer BFF preserve owner rejection of an invalid history cursor", async (t) => {
  const names = ["BTHWANI_DOCKER_WALLET_WEB_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN", "BTHWANI_ISOLATED_TEST_MODE"];
  const saved = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => {
    if (saved[i] === undefined) delete process.env[name];
    else process.env[name] = saved[i];
  }));
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  const cursor = "A".repeat(20); // Bounded syntax, but not an owner-issued keyset.
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.pathname, "/v1/wallets/me/transactions");
    assert.equal(url.searchParams.get("cursor"), cursor);
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    return Response.json({ error: "INVALID_REQUEST" }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  });
  await assert.rejects(() => readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:3203", bearer, new AbortController().signal, cursor,
  ), { status: 400 });
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  const response = await GET(new Request(
    "http://127.0.0.1:18101/api/customer-auth/wallet-transactions?cursor=" + cursor,
    { headers: { Cookie: "bthwani_customer_auth=" + bearer } },
  ));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_REQUEST" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(globalThis.fetch.mock.callCount(), 2);
});

test("Customer history BFF forwards a valid cursor only and refuses all other selectors", async (t) => {
  const names = ["BTHWANI_DOCKER_WALLET_WEB_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN", "BTHWANI_ISOLATED_TEST_MODE"];
  const old = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (old[index] === undefined) delete process.env[name];
    else process.env[name] = old[index];
  }));
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  const base = "http://127.0.0.1:18101/api/customer-auth/wallet-transactions";
  const headers = {
    Cookie: `bthwani_customer_auth=${Buffer.alloc(32, 17).toString("base64url")}`,
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.search, `?cursor=${nextCursor}`);
    return Response.json(pageTwo, { headers: { "Cache-Control": "no-store" } });
  });
  for (const suffix of ["?actorId=actor-b", "?cursor=bad", `?cursor=${nextCursor}&actorId=actor-b`,
    `?cursor=${nextCursor}&cursor=${nextCursor}`, "?limit=1000"]) {
    assert.equal((await GET(new Request(base + suffix, { headers }))).status, 400, suffix);
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  const result = await GET(new Request(`${base}?cursor=${nextCursor}`, { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), pageTwo);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("WLT read-only SDK admits only the Android emulator's isolated host bridge", async (t) => {
  const { readCurrentCustomerWallet } = await import("@bthwani/wlt");
  const token = Buffer.alloc(32, 9).toString("base64url");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "http://10.0.2.2:23203/v1/wallets/me");
    assert.equal(options.headers.Authorization, "Bearer " + token);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: "2500", availableYer: "2500" },
      { headers: { "Cache-Control": "no-store" } });
  });
  assert.equal((await readCurrentCustomerWallet("http://10.0.2.2:23203", token,
    new AbortController().signal)).balanceYer, "2500");
  for (const unsafe of ["http://10.0.2.3:23203", "http://user:pass@10.0.2.2:23203",
    "https://10.0.2.2:23203", "http://10.0.2.2:23203/other",
    "http://10.0.2.2:23203/?actorId=other", "http://10.0.2.2:99999",
    "http://192.168.1.1:23203"]) {
    await assert.rejects(() => readCurrentCustomerWallet(unsafe, token,
      new AbortController().signal), { status: 503 }, unsafe);
  }
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("WLT history accepts ten maximum-size postings without dropping a valid owner page", async (t) => {
  const token = Buffer.alloc(32, 19).toString("base64url");
  const postedAt = "2026-11-21T01:00:00.123456789Z";
  const items = Array.from({ length: 10 }, (_, index) => ({
    fundingId: "funding-" + "a".repeat(119) + (9 - index),
    amountYer: "9".repeat(38),
    postedAt,
    reversesFundingId: "original" + "b".repeat(119) + (9 - index),
  }));
  const last = items.at(-1);
  const page = {
    actorId: "a".repeat(128), currency: "YER", items, hasMore: true,
    nextCursor: Buffer.from(`${postedAt}|${last.fundingId}`).toString("base64url"),
  };
  const size = Buffer.byteLength(JSON.stringify(page));
  assert.ok(size > 4096 && size <= 8192, "fixture must exceed the old cap and stay bounded");
  let reply = Response.json(page, { headers: { "Cache-Control": "no-store" } });
  t.mock.method(globalThis, "fetch", async () => reply);
  const read = () => readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:3203", token, new AbortController().signal,
  );
  assert.deepEqual(await read(), page);

  // The Android/Hermes response adapter may have text() but no stream or
  // TextDecoder. Its byte counter must accept the same valid owner page.
  const originalDecoder = globalThis.TextDecoder;
  try {
    globalThis.TextDecoder = undefined;
    reply = {
      status: 200, headers: new Headers({
        "Cache-Control": "no-store", "Content-Type": "application/json",
      }),
      body: null, text: async () => JSON.stringify(page),
    };
    assert.deepEqual(await read(), page);
  } finally {
    globalThis.TextDecoder = originalDecoder;
  }

  reply = new Response("x".repeat(8193), { headers: {
    "Cache-Control": "no-store", "Content-Type": "application/json",
  } });
  await assert.rejects(read, { status: 502 }, "an oversized streaming response must still fail");
  reply = new Response("{}", { headers: {
    "Cache-Control": "no-store", "Content-Type": "application/json", "Content-Length": "8193",
  } });
  await assert.rejects(read, { status: 502 }, "declared oversized pages must fail before parsing");
});

test("WLT SDK rejects malformed or oversized streamed owner replies", async (t) => {
  const { readCurrentCustomerWallet } = await import("@bthwani/wlt");
  const token = Buffer.alloc(32, 7).toString("base64url");
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  let reply = new Response(Uint8Array.of(0xff), { headers });
  t.mock.method(globalThis, "fetch", async () => reply);
  const read = () => readCurrentCustomerWallet("http://127.0.0.1:3203",
    token, new AbortController().signal);

  await assert.rejects(read, { status: 502 }, "invalid UTF-8 must fail closed");
  reply = new Response("{", { headers });
  await assert.rejects(read, { status: 502 }, "invalid JSON must fail closed");
  reply = new Response("x".repeat(4097), { headers });
  await assert.rejects(read, { status: 502 }, "streamed JSON must have a byte limit");
  reply = new Response("{}", { headers: { ...headers, "Content-Length": "4097" } });
  await assert.rejects(read, { status: 502 }, "declared oversized content must be refused");
  assert.equal(globalThis.fetch.mock.callCount(), 4);
});

test("WLT SDK reads bounded text-only Native replies without depending on TextDecoder or streaming", async (t) => {
  const { readCurrentCustomerWallet } = await import("@bthwani/wlt");
  const token = Buffer.alloc(32, 12).toString("base64url");
  const response = (value, headers = new Headers({
    "Cache-Control": "no-store", "Content-Type": "application/json",
  })) => ({
    status: 200, ok: true, headers,
    text: async () => value, body: null,
  });
  const saved = globalThis.TextDecoder;
  try {
    globalThis.TextDecoder = undefined;
    t.mock.method(globalThis, "fetch", async () =>
      response('{"actorId":"actor-a","currency":"YER","balanceYer":"2500","availableYer":"2500"}'));
    const balance = await readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal);
    assert.equal(balance.balanceYer, "2500");
    globalThis.fetch.mock.mockImplementation(async () =>
      response(JSON.stringify({ actorId: "actor-a", currency: "YER",
        balanceYer: "9".repeat(4200) })));
    await assert.rejects(() => readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal), { status: 502 });
    globalThis.fetch.mock.mockImplementation(async () =>
      response('{"actorId":"actor-a","currency":"YER","balanceYer":"2500","availableYer":"2500"}',
        new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json",
          "Content-Length": "900000" })));
    await assert.rejects(() => readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal), { status: 502 });
  } finally {
    globalThis.TextDecoder = saved;
  }
});

test("WLT wallet projection distinguishes posted from available funding without precision loss", async () => {
  const { parseCustomerWalletBalance } = await import("@bthwani/wlt");
  const balance = { actorId: "actor-a", currency: "YER", balanceYer: "9007199254740993", availableYer: "9007199254740992" };
  assert.deepEqual(parseCustomerWalletBalance(balance), balance);
  for (const availableYer of ["9007199254740994", "-1", "01", "1.5", 0, null]) {
    assert.throws(() => parseCustomerWalletBalance({ ...balance, availableYer }), WltReadError);
  }
  const { availableYer, ...old } = balance;
  assert.throws(() => parseCustomerWalletBalance(old), WltReadError);
});

test("funding continuation refuses a repeated or newer owner key before any append", async (t) => {
  const token = Buffer.alloc(32, 17).toString("base64url");
  const older = { ...history, items: [{ fundingId: "funding-page-01", amountYer: "17", postedAt: "2026-11-19T23:59:59.999999999Z" }] };
  const invalid = [
    pageOne,
    { ...history, items: [{ fundingId: "funding-page-01", amountYer: "17", postedAt: "2026-11-20T00:00:00Z" }] },
    { ...history, items: [{ fundingId: "funding-page-00", amountYer: "17", postedAt: "2026-11-20T00:00:00Z" }] },
    { ...history, items: [{ fundingId: "funding-page-01", amountYer: "17", postedAt: "2026-11-20T00:00:00.000000001Z" }] },
  ];
  let body = older;
  t.mock.method(globalThis, "fetch", async () => Response.json(body, { headers: { "Cache-Control": "no-store" } }));
  const read = () => readCurrentCustomerWalletTransactions("http://127.0.0.1:3203", token, new AbortController().signal, nextCursor);
  assert.deepEqual(await read(), older);
  for (const page of invalid) {
    body = page;
    await assert.rejects(read, { status: 502 });
  }
  body = older;
  assert.deepEqual(await read(), older);
});

test("browser finance read refuses a newer page even when the current actor is unchanged", async (t) => {
  const newer = { ...history, items: [{ fundingId: "funding-2027", amountYer: "17", postedAt: "2027-01-01T00:00:00Z" }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(newer, { headers: { "Cache-Control": "no-store" } }));
  await assert.rejects(() => readVerifiedWalletTransactions(async () => live("actor-a"),
    new AbortController().signal, nextCursor, "actor-a"), { status: 502 });
});
test("owner cursor is canonical and permits equal-time strictly lower IDs, empty completion and retry", () => {
  const older = { ...history, items: [{ fundingId: "funding-page--1", amountYer: "17", postedAt: "2026-11-20T00:00:00Z" }] };
  assert.deepEqual(parseCustomerFundingHistory(older, nextCursor), older);
  const empty = { ...history, items: [] };
  assert.deepEqual(parseCustomerFundingHistory(empty, nextCursor), empty);
  for (const cursor of [
    "x", "A".repeat(20),
    Buffer.from("2026-11-20T00:00:00.000Z|funding-page-00").toString("base64url"),
    Buffer.from("2026-11-20T00:00:00Z|funding-page-00|extra").toString("base64url"),
    Buffer.from("2026-02-30T00:00:00Z|funding-page-00").toString("base64url"),
    nextCursor + "A",
  ]) {
    assert.throws(() => parseCustomerFundingHistory(empty, cursor), { status: 502 });
  }
  assert.deepEqual(parseCustomerFundingHistory(older, nextCursor), older);
});

test("history BFF rejects a stale owner page and recovers on the same continuation", async (t) => {
  const names = ["BTHWANI_DOCKER_WALLET_WEB_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN", "BTHWANI_ISOLATED_TEST_MODE"];
  const old = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (old[index] === undefined) delete process.env[name];
    else process.env[name] = old[index];
  }));
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  const request = () => new Request("http://127.0.0.1:18101/api/customer-auth/wallet-transactions?cursor=" + nextCursor,
    { headers: { Cookie: "bthwani_customer_auth=" + bearer } });
  let page = pageOne;
  t.mock.method(globalThis, "fetch", async () => Response.json(page, { headers: { "Cache-Control": "no-store" } }));
  const denied = await GET(request());
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: "OWNER_UNAVAILABLE" });
  page = pageTwo;
  const recovered = await GET(request());
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), pageTwo);
});
test("browser finance admission rejects malformed cursors without requesting a session", async (t) => {
  const signal = new AbortController().signal;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected network"); });
  const admission = async () => { calls++; return live("actor-a"); };
  for (const cursor of ["short", "x".repeat(241), "a".repeat(20) + "!"]) {
    assert.deepEqual(await readVerifiedWalletTransactions(admission, signal, cursor), { kind: "unavailable" });
  }
  assert.equal(calls, 0);
});

test("browser finance checks disabled admission, absent session and owner denial", async (t) => {
  const signal = new AbortController().signal;
  let response = () => Response.json(history, { headers: { "Cache-Control": "no-store" } });
  t.mock.method(globalThis, "fetch", async () => response());
  const denied = { enabled: false, session: null };
  const missing = { enabled: true, session: null };
  assert.deepEqual(await readVerifiedWalletTransactions(async () => denied, signal), { kind: "unavailable" });
  assert.deepEqual(await readVerifiedWalletTransactions(async () => missing, signal), { kind: "signed-out" });
  for (const after of [denied, missing]) {
    const sessions = [live("actor-a"), after];
    assert.deepEqual(await readVerifiedWalletTransactions(async () => sessions.shift(), signal), { kind: "signed-out" });
  }
  response = () => new Response("denied", { status: 403 });
  assert.deepEqual(await readVerifiedWalletTransactions(async () => live("actor-a"), signal), { kind: "signed-out" });
  response = () => new Response("denied", { status: 503 });
  assert.deepEqual(await readVerifiedWalletTransactions(async () => live("actor-a"), signal), { kind: "unavailable" });
});
test("browser finance cancels rejected or malformed responses even if cancellation rejects", async (t) => {
  const signal = new AbortController().signal;
  let cancellations = 0;
  let status = 403;
  t.mock.method(globalThis, "fetch", async () => ({
    status,
    headers: new Headers({ "Cache-Control": "no-store", "Content-Type": "text/plain" }),
    body: { locked: false, cancel: async () => { cancellations++; throw new Error("closed"); } },
  }));
  assert.deepEqual(await readVerifiedWalletTransactions(async () => live("actor-a"), signal), { kind: "signed-out" });
  status = 200;
  await assert.rejects(readVerifiedWalletTransactions(async () => live("actor-a"), signal), { status: 502 });
  assert.equal(cancellations, 3);
});
