import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const body = {
  actorId: "synthetic-customer-owner", currency: "YER", balanceYer: "0", availableYer: "0",
};
const history = {
  actorId: body.actorId, currency: "YER", items: [], hasMore: false, nextCursor: null,
};

test("isolated Docker Customer Web uses only the existing HttpOnly session and verified WLT loopback owner", async (t) => {
  const names = [
    "BTHWANI_SURFACE_PREVIEW",
    "BTHWANI_DOCKER_WALLET_WEB_PREVIEW",
    "BTHWANI_ISOLATED_TEST_MODE",
    "CUSTOMER_SYNTHETIC_WLT_ORIGIN",
  ];
  const saved = names.map((name) => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (saved[index] === undefined) delete process.env[name];
    else process.env[name] = saved[index];
  }));
  process.env.BTHWANI_SURFACE_PREVIEW = "0";
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "1";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  const { GET: wallet } = await import("../app/api/customer-auth/wallet+api.ts");
  const { GET: transactions } = await import("../app/api/customer-auth/wallet-transactions+api.ts");
  const bearer = Buffer.alloc(32, 17).toString("base64url");
  const url = "http://127.0.0.1:28111/api/customer-auth/";
  const headers = { Cookie: `bthwani_customer_auth=${bearer}` };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (ownerUrl, options) => {
    calls.push(ownerUrl.href);
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    const value = ownerUrl.pathname.endsWith("/transactions") ? history : body;
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  });
  assert.equal((await wallet(new Request(url + "wallet"))).status, 401);
  assert.equal((await wallet(new Request(url + "wallet?actorId=other", { headers }))).status, 400);
  assert.equal((await wallet(new Request(url + "wallet", {
    headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
  }))).status, 403);
  const response = await wallet(new Request(url + "wallet", { headers }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), body);
  const readHistory = await transactions(new Request(url + "wallet-transactions", { headers }));
  assert.equal(readHistory.status, 200);
  assert.deepEqual(await readHistory.json(), history);
  assert.deepEqual(calls, [
    "http://127.0.0.1:3203/v1/wallets/me",
    "http://127.0.0.1:3203/v1/wallets/me/transactions",
  ]);

  // The flag alone must never send a Customer bearer to another loopback port.
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3290";
  assert.equal((await wallet(new Request(url + "wallet", { headers }))).status, 503);
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  assert.equal((await wallet(new Request(url + "wallet", { headers }))).status, 503,
    "Surface opt-in must not bypass the strict Docker owner pin");
  process.env.BTHWANI_SURFACE_PREVIEW = "0";
  process.env.CUSTOMER_SYNTHETIC_WLT_ORIGIN = "http://127.0.0.1:3203";
  process.env.BTHWANI_ISOLATED_TEST_MODE = "false";
  assert.equal((await wallet(new Request(url + "wallet", { headers }))).status, 503);
  process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
  process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW = "0";
  assert.equal((await wallet(new Request(url + "wallet", { headers }))).status, 503);
  assert.equal(calls.length, 2);
});

test("Docker Customer Web launcher opts in only for verified local owners, never for native or other apps", () => {
  const script = readFileSync(new URL("../../../tools/dev/Start-RefoundationApp.ps1", import.meta.url), "utf8");
  assert.match(script, /EnableDockerWalletWebPreview/);
  assert.match(script, /DOCKER_WALLET_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY/);
  assert.match(script, /DOCKER_WALLET_WEB_PREVIEW_REQUIRES_VERIFIED_LENOVO_HOST/);
  assert.match(script, /identity-synthetic-session-verifier/);
  assert.match(script, /customer-wallet-read-only/);
  assert.match(script, /CUSTOMER_SYNTHETIC_WLT_ORIGIN='http:\/\/127\.0\.0\.1:3203'/);
  assert.match(script, /BTHWANI_DOCKER_WALLET_WEB_PREVIEW='1'/);
  assert.match(script, /BTHWANI_ISOLATED_TEST_MODE='true'/);
  assert.match(script, /EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='0'/);
  assert.match(script, /Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN/);
});
