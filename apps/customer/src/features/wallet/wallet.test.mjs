import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readVerifiedWallet } from "./wallet-read.web.ts";

test("native wallet and cash-in continue to fail closed", () => {
  for (const file of ["wallet-screen.tsx", "cash-in-panel.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /CapabilityUnavailableScreen/);
    assert.doesNotMatch(source, /fetch\(|credit\(|debit\(/);
  }
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
