import assert from "node:assert/strict";
import { test } from "node:test";
import {
  admitCurrentCustomerAsMerchant,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  readVerifiedIdentitySession,
  resumeCurrentCustomerMerchantSession,
  revokeVerifiedIdentitySession,
  verifyCustomerPhoneChallenge,
} from "../../services/identity/clients/index.ts";

const origin = "https://identity.bthwani.test";
const bearer = Buffer.alloc(32, 17).toString("base64url");
const rotatedBearer = Buffer.alloc(32, 29).toString("base64url");
const expires = () => new Date(Date.now() + 15 * 60_000).toISOString();
const principal = () => ({ actorId: "actor-123", role: "customer", sessionExpiresAt: expires() });
const admission = () => ({ accessToken: rotatedBearer, sessionExpiresAt: expires() });
const response = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
const rejectsAs = (call, status, code) =>
  assert.rejects(call, error => error instanceof IdentityClientError &&
    error.status === status && error.code === code);

async function withFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("only opaque 256-bit base64url tokens are admitted; invalid origins never reach the network", async () => {
  assert.equal(bearer.length, 43);
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return response(principal());
  }, async () => {
    for (const bad of [
      "", "not a URL", "http://identity.example.test",
      "https://operator:password@identity.example.test",
      "https://identity.example.test/path",
      "https://identity.example.test?token=leak",
      "https://identity.example.test/#fragment",
      "ftp://identity.example.test",
    ]) {
      await assert.rejects(() => readVerifiedIdentitySession(bad, bearer),
        error => error instanceof IdentityClientError &&
          error.code.startsWith("IDENTITY_ENDPOINT_"));
    }
    for (const bad of ["", "short", "A".repeat(43), "A".repeat(42) + "/", "A".repeat(44)]) {
      if (bad === "A".repeat(43)) continue; // Canonical base64url of zero bytes is valid.
      await rejectsAs(() => readVerifiedIdentitySession(origin, bad), 401, "UNAUTHORIZED");
    }
  });
  assert.equal(calls, 0);
});

test("verified-session GET uses no cookies, redirects, cached data or Caller-supplied actor", async () => {
  const expected = principal();
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/sessions/current");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.headers.Accept, "application/json");
    assert.equal("body" in options, false);
    return response(expected);
  }, async () => assert.deepEqual(await readVerifiedIdentitySession(origin, bearer), expected));
});

test("session scope is parsed from exactly the three owner fields and never implies Store rights", async () => {
  const valid = principal();
  await withFetch(async () => response(valid), async () => {
    const session = await readVerifiedIdentitySession(origin, bearer);
    assert.deepEqual(Object.keys(session).sort(), ["actorId", "role", "sessionExpiresAt"]);
    assert.equal("storeId" in session, false);
  });
  for (const value of [
    null, [], {},
    { ...valid, actorId: "" },
    { ...valid, actorId: " actor-123 " },
    { ...valid, role: "admin" },
    { ...valid, role: null },
    { ...valid, role: ["customer"] },
    { ...valid, storeId: "other-owner-store" },
    { ...valid, sessionExpiresAt: "not-a-date" },
    { ...valid, sessionExpiresAt: "2035-01-01" },
    { ...valid, sessionExpiresAt: new Date(Date.now() - 1000).toISOString() },
  ]) {
    await withFetch(async () => response(value),
      () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  }
});

test("phone proof carries exact JSON without credentials and logout requires a no-store 204", async () => {
  const phone = "+12025550133";
  const ticket = "a".repeat(48);
  const code = "123456";
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/customer-auth/phone-challenges");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { phone });
    return response({ ticket }, 201);
  }, async () => assert.equal(await issueCustomerPhoneChallenge(origin, phone), ticket));
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/customer-auth/phone-verification");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { ticket, code });
    return response(admission());
  }, async () => assert.equal((await verifyCustomerPhoneChallenge(origin, ticket, code)).accessToken, rotatedBearer));
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/sessions/current");
    assert.equal(options.method, "DELETE");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }, async () => revokeVerifiedIdentitySession(origin, bearer));
  await withFetch(async () => new Response(null, { status: 204 }),
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
});

test("Merchant admission performs exact POST with verified Customer token and no implicit Store grant", async () => {
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/actors/me/merchant-role");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal("body" in options, false);
    return response(admission(), 201);
  }, async () => {
    const newMerchant = await admitCurrentCustomerAsMerchant(origin, bearer);
    assert.deepEqual(Object.keys(newMerchant).sort(), ["accessToken", "sessionExpiresAt"]);
    assert.equal(newMerchant.accessToken, rotatedBearer);
    assert.equal("storeId" in newMerchant, false);
  });
});

test("Merchant re-entry has a distinct endpoint and expected status, never provisions a Store", async () => {
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/actors/me/merchant-session");
    assert.equal(options.method, "POST");
    return response(admission(), 200);
  }, async () => {
    const current = await resumeCurrentCustomerMerchantSession(origin, bearer);
    assert.equal(current.accessToken, rotatedBearer);
    assert.equal("storeGrant" in current, false);
  });
});

test("Merchant response rejects malformed tokens, expired credentials, extra fields and wrong status", async () => {
  for (const value of [
    null, [], {},
    { ...admission(), accessToken: "short" },
    { ...admission(), sessionExpiresAt: "2035-01-01" },
    { ...admission(), sessionExpiresAt: new Date(Date.now() - 1000).toISOString() },
    { ...admission(), walletBalance: 10_000 },
    { ...admission(), storeAccess: "superuser" },
  ]) {
    await withFetch(async () => response(value, 201),
      () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  }
  await withFetch(async () => response(admission(), 200),
    () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
  await withFetch(async () => response(admission(), 201),
    () => rejectsAs(() => resumeCurrentCustomerMerchantSession(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
});

test("owner error codes are allowlisted and cannot expose raw private server data", async () => {
  for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "VERIFICATION_REQUIRED"], [409, "ALREADY_PROVISIONED"]]) {
    await withFetch(async () => response({ error: code }, status),
      () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), status, code));
  }
  await withFetch(async () => response({ error: "DATABASE_PASSWORD_EXPOSED" }, 401),
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 401, "OWNER_REQUEST_FAILED"));
  await withFetch(async () => new Response("private stack trace", { status: 503 }),
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 503, "OWNER_REQUEST_FAILED"));
  await withFetch(async () => new Response("unavailable", { status: 503 }),
    () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 503, "OPERATION_RESULT_UNKNOWN"));
});

test("protected owner reads fail closed on uncacheable JSON and oversized responses", async () => {
  for (const headers of [
    { "Content-Type": "text/html" },
    { "Content-Type": "application/json", "Cache-Control": "public" },
    { "Content-Type": "application/json", "Cache-Control": "no-store-unsafe" },
  ]) {
    await withFetch(async () => response(principal(), 200, headers),
      () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  }
  await withFetch(async () => new Response(JSON.stringify(principal()), {
    status: 200, headers: { "Content-Type": "application/json" },
  }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => response(principal(), 200, { "Content-Length": "50000" }),
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  await withFetch(async () => new Response(JSON.stringify(principal()) + " ".repeat(17_000), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
});

test("network and timeout failures do not manufacture a completed Identity operation", async () => {
  await withFetch(async () => { throw new Error("socket closed: sensitive"); },
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 0, "OWNER_NETWORK_UNAVAILABLE"));
  await withFetch(async () => { throw new Error("connection reset"); },
    () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 0, "OPERATION_RESULT_UNKNOWN"));
});

test("cancelled or stale readback never revives an old Identity session or rotates a Merchant credential", async () => {
  const controller = new AbortController();
  await withFetch(async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    controller.abort();
    return response(principal());
  }, () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer, controller.signal),
    0, "OWNER_RESPONSE_STALE"));
  const another = new AbortController();
  await withFetch(async () => {
    another.abort();
    return response(admission(), 201);
  }, () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer, another.signal),
    0, "OPERATION_RESULT_UNKNOWN"));
});
