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
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount },
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

test("a changed account after the wallet response cannot display the previous balance", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount },
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
    Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount },
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
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount },
      { headers: { "Cache-Control": "no-store" } });
  });
  await assert.rejects(() => readVerifiedWallet(async () => live("actor-a"), controller.signal),
    { name: "AbortError" });
});

test("the Web wallet route uses only the isolated loopback owner and the existing HttpOnly session", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "http://127.0.0.1:23203/v1/wallets/me");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + Buffer.alloc(32, 17).toString("base64url"));
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: amount },
      { headers: { "Cache-Control": "no-store" } });
  });
  const saved = [process.env.BTHWANI_SURFACE_PREVIEW, process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN];
  t.after(() => {
    const names = ["BTHWANI_SURFACE_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN"];
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  });
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:23203";
  const { GET } = await import("../../../app/api/customer-auth/wallet+api.ts");
  const path = "http://127.0.0.1:23101/api/customer-auth/wallet";
  const headers = { Cookie: "bthwani_surface_customer_auth=" + Buffer.alloc(32, 17).toString("base64url") };
  assert.equal((await GET(new Request(path))).status, 401);
  assert.equal((await GET(new Request(path + "?actorId=other", { headers }))).status, 400);
  assert.equal((await GET(new Request(path, { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const shown = await GET(new Request(path, { headers }));
  assert.equal(shown.headers.get("Cache-Control"), "no-store");
  assert.equal((await shown.json()).balanceYer, amount);
  delete process.env.BTHWANI_SURFACE_PREVIEW;
  assert.equal((await GET(new Request(path, { headers }))).status, 503);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

const history = {
  actorId: "actor-a", currency: "YER", hasMore: false, nextCursor: null,
  items: [{ fundingId: "funding-0001", amountYer: amount, postedAt: "2026-11-20T00:00:00Z" }],
};

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
    assert.equal(url.href, "http://127.0.0.1:23203/v1/wallets/me/transactions");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return Response.json(history, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:23203", bearer, new AbortController().signal,
  ), history);
  await assert.rejects(() => readCurrentCustomerWalletTransactions(
    "http://attacker.invalid", bearer, new AbortController().signal,
  ), { status: 503 });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("Customer wallet history BFF denies cross-site and arbitrary actor queries", async (t) => {
  const names = ["BTHWANI_SURFACE_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN"];
  const saved = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => {
    if (saved[i] === undefined) delete process.env[name];
    else process.env[name] = saved[i];
  }));
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:23203";
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  t.mock.method(globalThis, "fetch", async () => Response.json(history,
    { headers: { "Cache-Control": "no-store" } }));
  const path = "http://127.0.0.1:23101/api/customer-auth/wallet-transactions";
  const headers = { Cookie: `bthwani_surface_customer_auth=${Buffer.alloc(32, 17).toString("base64url")}` };
  assert.equal((await GET(new Request(path))).status, 401);
  assert.equal((await GET(new Request(`${path}?actorId=other`, { headers }))).status, 400);
  assert.equal((await GET(new Request(path, { headers: { ...headers, "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const result = await GET(new Request(path, { headers }));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await result.json(), history);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

const nextCursor = Buffer.from("2026-11-20T00:00:00Z|funding-0001").toString("base64url");
const tenFunding = Array.from({ length: 10 }, (_, index) => ({
  fundingId: `funding-page-${index.toString().padStart(2, "0")}`,
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
    { ...pageOne, items: tenFunding.slice(0, 9) },
    { ...history, hasMore: true },
    { ...history, nextCursor },
    { ...history, nextCursor: "x".repeat(241) },
  ]) {
    assert.throws(() => parseCustomerFundingHistory(invalid), WltReadError);
  }
});

test("a verified Customer can request an older bounded WLT history page", async (t) => {
  let admissionReads = 0;
  t.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(path, `/api/customer-auth/wallet-transactions?cursor=${nextCursor}`);
    assert.equal(options.credentials, "same-origin");
    return Response.json(pageOne, { headers: { "Cache-Control": "no-store" } });
  });
  const result = await readVerifiedWalletTransactions(async () => {
    admissionReads++;
    return live("actor-a");
  }, new AbortController().signal, nextCursor);
  assert.equal(admissionReads, 2);
  assert.equal(result.kind, "ready");
  assert.equal(result.history.nextCursor, nextCursor);
});

test("a changed Customer cannot inherit an older wallet history page", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(pageOne, { headers: { "Cache-Control": "no-store" } }));
  const sessions = [live("actor-a"), live("actor-b")];
  const result = await readVerifiedWalletTransactions(
    async () => sessions.shift(), new AbortController().signal, nextCursor,
  );
  assert.deepEqual(result, { kind: "signed-out" });
});

test("WLT SDK forwards only a canonical cursor to its isolated owner", async (t) => {
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, `http://127.0.0.1:23203/v1/wallets/me/transactions?cursor=${nextCursor}`);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    return Response.json(pageOne, { headers: { "Cache-Control": "no-store" } });
  });
  assert.deepEqual(await readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:23203", bearer, new AbortController().signal, nextCursor,
  ), pageOne);
  await assert.rejects(() => readCurrentCustomerWalletTransactions(
    "http://127.0.0.1:23203", bearer, new AbortController().signal, "invalid",
  ), { status: 400 });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("Customer history BFF forwards a valid cursor only and refuses all other selectors", async (t) => {
  const names = ["BTHWANI_SURFACE_PREVIEW", "CUSTOMER_SYNTHETIC_WLT_ORIGIN"];
  const old = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (old[index] === undefined) delete process.env[name];
    else process.env[name] = old[index];
  }));
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:23203";
  const { GET } = await import("../../../app/api/customer-auth/wallet-transactions+api.ts");
  const base = "http://127.0.0.1:23101/api/customer-auth/wallet-transactions";
  const headers = {
    Cookie: `bthwani_surface_customer_auth=${Buffer.alloc(32, 17).toString("base64url")}`,
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.search, `?cursor=${nextCursor}`);
    return Response.json(pageOne, { headers: { "Cache-Control": "no-store" } });
  });
  for (const suffix of ["?actorId=actor-b", "?cursor=bad", `?cursor=${nextCursor}&actorId=actor-b`,
    `?cursor=${nextCursor}&cursor=${nextCursor}`, "?limit=1000"]) {
    assert.equal((await GET(new Request(base + suffix, { headers }))).status, 400, suffix);
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  const result = await GET(new Request(`${base}?cursor=${nextCursor}`, { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), pageOne);
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
    return Response.json({ actorId: "actor-a", currency: "YER", balanceYer: "2500" },
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
      response('{"actorId":"actor-a","currency":"YER","balanceYer":"2500"}'));
    const balance = await readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal);
    assert.equal(balance.balanceYer, "2500");
    globalThis.fetch.mock.mockImplementation(async () =>
      response(JSON.stringify({ actorId: "actor-a", currency: "YER",
        balanceYer: "9".repeat(4200) })));
    await assert.rejects(() => readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal), { status: 502 });
    globalThis.fetch.mock.mockImplementation(async () =>
      response('{"actorId":"actor-a","currency":"YER","balanceYer":"2500"}',
        new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json",
          "Content-Length": "900000" })));
    await assert.rejects(() => readCurrentCustomerWallet("http://10.0.2.2:23203",
      token, new AbortController().signal), { status: 502 });
  } finally {
    globalThis.TextDecoder = saved;
  }
});
