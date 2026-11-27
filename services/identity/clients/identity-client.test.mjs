import assert from "node:assert/strict";
import { test } from "node:test";
import {
  admitCurrentCustomerAsMerchant,
  changeOriginalOperatorPermission,
  establishPersistentIdentitySession,
  IdentityClientError,
  issueCustomerPhoneChallenge,
  normalizeYemeniMobile,
  readPersistentIdentityRole,
  readVerifiedIdentitySession,
  resumeCurrentCustomerMerchantSession,
  reviewOriginalOperatorPermissions,
  revokePersistentIdentitySession,
  revokeVerifiedIdentitySession,
  rotatePersistentIdentitySession,
  verifyCustomerPhoneChallenge,
} from "./index.ts";

test("Yemeni mobile input becomes one canonical owner number", () => {
  for (const input of ["770000001", "+967770000001", "٧٧٠٠٠٠٠٠١", " ۷۷۰۰۰۰۰۰۱ "]) {
    assert.equal(normalizeYemeniMobile(input), "+967770000001");
  }
  assert.equal(normalizeYemeniMobile("720000001"), "+967720000001");
  for (const input of ["+12025550100", "790000001", "77000001", "abc770000001"]) {
    assert.equal(normalizeYemeniMobile(input), undefined);
  }
});

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

test("Operator permission review binds the result to a single target and accepts only known scope revisions", async () => {
  const target = "operator-123";
  const permission = { permission: "operations", state: "REVOKED", version: 2 };
  const expected = { targetActorId: target, permissions: [permission] };
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/operators/operator-123/permissions");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.cache, "no-store");
    return response(expected);
  }, async () => {
    assert.deepEqual(await reviewOriginalOperatorPermissions(origin, bearer, target), [permission]);
    await rejectsAs(() => reviewOriginalOperatorPermissions(origin, bearer, "invalid/id"), 400, "INVALID_REQUEST");
  });
  for (const value of [
    { ...expected, targetActorId: "operator-other" },
    { ...expected, permissions: [permission, permission] },
    { ...expected, permissions: [{ ...permission, permission: "partners" }] },
    { ...expected, permissions: [{ ...permission, version: 0 }] },
  ]) {
    await withFetch(async () => response(value), () =>
      rejectsAs(() => reviewOriginalOperatorPermissions(origin, bearer, target), 502, "OWNER_RESPONSE_INVALID"));
  }
});

test("Operator permission writes preserve the command and only acknowledge a matching owner receipt", async () => {
  const actorId = "synthetic-operator";
  const command = { state: "ACTIVE", expectedVersion: 0, operationId: "permission-op-1", reason: "سبب موثّق للاختبار" };
  const receipt = { targetActorId: actorId, permission: "operations", state: "ACTIVE", version: 1 };
  const send = () => changeOriginalOperatorPermission(origin, bearer, actorId, "operations", command);
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/operators/synthetic-operator/permissions/operations");
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), command);
    return response(receipt);
  }, async () => assert.deepEqual(await send(), { permission: "operations", state: "ACTIVE", version: 1 }));
  for (const mismatch of [
    { targetActorId: "other-actor" }, { permission: "finance" }, { state: "REVOKED" }, { version: 2 },
  ]) {
    await withFetch(async () => response({ ...receipt, ...mismatch }),
      () => rejectsAs(send, 502, "OPERATION_RESULT_UNKNOWN"));
  }
  await withFetch(async () => response({ error: "CONFLICT" }, 409),
    () => rejectsAs(send, 409, "CONFLICT"));
  await withFetch(async () => { throw new Error("interrupted after dispatch"); },
    () => rejectsAs(send, 0, "OPERATION_RESULT_UNKNOWN"));
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

test("verified Identity actor IDs follow Go's UTF-8 byte and Unicode control limits", async () => {
  const allowed = { ...principal(), actorId: "ع".repeat(64) };
  await withFetch(async () => response(allowed),
    async () => assert.deepEqual(await readVerifiedIdentitySession(origin, bearer), allowed));
  for (const actorId of ["ع".repeat(65), "actor\u0001name", "actor\u0085name", "actor\ud800name"]) {
    await withFetch(async () => response({ ...principal(), actorId }),
      () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  }
});

test("phone proof carries exact JSON without credentials and logout requires a no-store 204", async () => {
  const phone = "+967770000033";
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
  // A no-body 204 without no-store cannot verify owner revocation, but the
  // DELETE may already have committed: keep the outcome unknown.
  await withFetch(async () => new Response(null, { status: 204 }),
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
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
      // Even malformed issued credentials may indicate a committed owner role/session mutation.
      () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
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

test("Identity revocation never classifies an uncertain DELETE as an ordinary read outage", async () => {
  await withFetch(async () => { throw new Error("connection lost after revocation"); },
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 0, "OPERATION_RESULT_UNKNOWN"));
  await withFetch(async () => response({ error: "OWNER_UNAVAILABLE" }, 503),
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 503, "OPERATION_RESULT_UNKNOWN"));
  await withFetch(async () => response({ unexpected: true }, 200),
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
  await withFetch(async () => new Response(null, { status: 204 }),
    () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN"));
  const controller = new AbortController();
  await withFetch(async () => {
    controller.abort();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }, () => rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer, controller.signal),
    0, "OPERATION_RESULT_UNKNOWN"));
});

test("late Identity denial must not sign out a replacement account or confirm a cancelled POST", async () => {
  const denied = new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const current = new AbortController();
  denied.json = async () => {
    current.abort();
    return { error: "UNAUTHORIZED" };
  };
  await withFetch(async () => denied,
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer, current.signal),
      0, "OWNER_RESPONSE_STALE"));

  const cancelledPost = new AbortController();
  const failed = new Response(JSON.stringify({ error: "VERIFICATION_REQUIRED" }), {
    status: 403,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  failed.json = async () => {
    cancelledPost.abort();
    return { error: "VERIFICATION_REQUIRED" };
  };
  await withFetch(async () => failed,
    () => rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer, cancelledPost.signal),
      0, "OPERATION_RESULT_UNKNOWN"));
});

test("malformed successful Identity POST responses never certify that a mutation did not commit", async () => {
  let requests = 0;
  await withFetch(async (_url, options) => {
    requests++;
    assert.equal(options.method, "POST");
    return response({ ticket: "malformed-proof-ticket" }, 201);
  }, async () => {
    await rejectsAs(() => issueCustomerPhoneChallenge(origin, "+967770000033"),
      502, "OPERATION_RESULT_UNKNOWN");
  });
  assert.equal(requests, 1, "the client must not silently send the SMS challenge twice");

  await withFetch(async (_url, options) => {
    requests++;
    assert.equal(options.method, "POST");
    return response({ ...admission(), accessToken: "invalid-issued-token" });
  }, async () => {
    await rejectsAs(() => verifyCustomerPhoneChallenge(origin, "a".repeat(48), "123456"),
      502, "OPERATION_RESULT_UNKNOWN");
  });
  assert.equal(requests, 2, "a consumed proof must not be replayed after an invalid owner reply");
});

test("Persistent Identity lifecycle uses isolated owner paths, exact secret schemas and no browser cookies",async()=>{
  const refresh=Buffer.alloc(32,35).toString("base64url");
  const newer=Buffer.alloc(32,36).toString("base64url");
  const durableExpiry=new Date(Date.now()+30*24*60*60_000).toISOString();
  const verifyRequest=(url,opts,path,method,token)=>{
    assert.equal(new URL(url).pathname,path);
    assert.equal(opts.method,method);
    assert.equal(opts.headers.Authorization,"Bearer "+token);
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.cache,"no-store");
    assert.equal("body" in opts,false);
  };
  await withFetch(async (url,opts)=>{
    verifyRequest(url,opts,"/v1/sessions/persistent","POST",bearer);
    return response({refreshToken:refresh,refreshExpiresAt:durableExpiry},201);
  },async()=>assert.deepEqual(await establishPersistentIdentitySession(origin,bearer),
    {refreshToken:refresh,refreshExpiresAt:durableExpiry}));
  const rotated={accessToken:rotatedBearer,sessionExpiresAt:expires(),refreshToken:newer,refreshExpiresAt:durableExpiry};
  await withFetch(async(url,opts)=>{
    verifyRequest(url,opts,"/v1/sessions/refresh","POST",refresh);
    return response(rotated);
  },async()=>assert.deepEqual(await rotatePersistentIdentitySession(origin,refresh),rotated));
  await withFetch(async(url,opts)=>{
    verifyRequest(url,opts,"/v1/sessions/refresh","DELETE",newer);
    return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  },async()=>assert.equal(await revokePersistentIdentitySession(origin,newer),undefined));
  for (const malformed of [
    {...rotated,debug:"actor"},
    {...rotated,refreshToken:"forged"},
    {...rotated,refreshExpiresAt:new Date(Date.now()-100).toISOString()},
    {...rotated,sessionExpiresAt:"today"},
  ]){
    await withFetch(async()=>response(malformed),()=>
      rejectsAs(()=>rotatePersistentIdentitySession(origin,refresh),502,"OPERATION_RESULT_UNKNOWN"));
  }
  await withFetch(async()=>response({error:"UNAUTHORIZED"},401),
    ()=>rejectsAs(()=>rotatePersistentIdentitySession(origin,refresh),401,"UNAUTHORIZED"));
});

test("background cancellation cannot discard an acknowledged persistent rotation", async () => {
  const controller = new AbortController();
  const refresh = Buffer.alloc(32, 35).toString("base64url");
  const newer = Buffer.alloc(32, 36).toString("base64url");
  const rotated = { ...admission(), refreshToken: newer, refreshExpiresAt: expires() };
  let prepared = false;
  let committed = null;
  let rotations = 0;
  await withFetch(async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/v1/sessions/current") {
      assert.equal(options.headers.Authorization, "Bearer " + bearer);
      return response({ error: "UNAUTHORIZED" }, 401);
    }
    assert.equal(path, "/v1/sessions/refresh");
    assert.equal(options.method, "POST");
    assert.equal(prepared, true);
    rotations++;
    controller.abort();
    return response(rotated);
  }, async () => {
    await rejectsAs(() => readPersistentIdentityRole(origin, bearer, refresh, "customer",
      controller.signal, async () => { prepared = true; }, async (credentials, previous, rotatedFlag) => {
        assert.equal(previous, bearer);
        assert.equal(rotatedFlag, true);
        committed = credentials;
        return true;
      }), 0, "OWNER_RESPONSE_STALE");
    assert.deepEqual(committed, rotated);
    assert.equal(rotations, 1);
  });
});

async function expectPromptCancellation(call, started, controller, code, release) {
  let outcome;
  const pending = call().then(value => { outcome = { value }; }, error => { outcome = { error }; });
  await started;
  controller.abort();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(outcome, "aborted Identity request must settle before the bridge");
    assert.ok(outcome.error instanceof IdentityClientError);
    assert.equal(outcome.error.status, 0);
    assert.equal(outcome.error.code, code);
  } finally { release(); await pending; }
}

test("non-cooperative Identity headers cancel and allow a successor", async () => {
  const controller = new AbortController(), stalled = Promise.withResolvers(), started = Promise.withResolvers();
  let calls = 0;
  await withFetch((_url, opts) => {
    calls++;
    if (calls === 1) { assert.equal(opts.signal, controller.signal); started.resolve(); return stalled.promise; }
    return Promise.resolve(response(principal()));
  }, async () => {
    await expectPromptCancellation(() => readPersistentIdentityRole(origin, bearer, rotatedBearer, "customer",
      controller.signal, async () => assert.fail("must not rotate"), async () => assert.fail("must not commit")),
      started.promise, controller, "OWNER_RESPONSE_STALE", () => stalled.resolve(response(principal())));
    assert.equal((await readVerifiedIdentitySession(origin, bearer)).actorId, "actor-123");
    assert.equal(calls, 2);
  });
});

for (const status of [200, 401]) {
  test(`non-cooperative Identity body cancellation: ${status}`, async () => {
    const controller = new AbortController(), stalled = Promise.withResolvers(), started = Promise.withResolvers();
    const res = response(status === 200 ? principal() : { error: "UNAUTHORIZED" }, status);
    const read = () => { started.resolve(); return stalled.promise; };
    if (status === 200) res.text = read; else res.json = read;
    await withFetch(async () => res, () => expectPromptCancellation(
      () => readVerifiedIdentitySession(origin, bearer, controller.signal), started.promise, controller,
      "OWNER_RESPONSE_STALE", () => stalled.reject(new Error("late bridge failure"))));
  });
}

test("non-cooperative Identity POST remains unknown and is not retried", async () => {
  const controller = new AbortController(), stalled = Promise.withResolvers(), started = Promise.withResolvers();
  let calls = 0;
  await withFetch((_url, opts) => { calls++; assert.equal(opts.method, "POST"); started.resolve(); return stalled.promise; },
    () => expectPromptCancellation(() => admitCurrentCustomerAsMerchant(origin, bearer, controller.signal),
      started.promise, controller, "OPERATION_RESULT_UNKNOWN", () => stalled.resolve(response(admission(), 201))));
  assert.equal(calls, 1);
});

test("pre-cancelled Identity operations never dispatch", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await withFetch(async () => { calls++; return response(principal()); }, async () => {
    await rejectsAs(() => readVerifiedIdentitySession(origin, bearer, controller.signal), 0, "OWNER_RESPONSE_STALE");
    await rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer, controller.signal), 0, "OPERATION_RESULT_UNKNOWN");
    assert.equal(calls, 0);
  });
});

test("Identity removes its abort listeners after completion", async () => {
  const signal = new AbortController().signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  const active = new Set();
  signal.addEventListener = (name, fn, opts) => { if (name === "abort") active.add(fn); add(name, fn, opts); };
  signal.removeEventListener = (name, fn, opts) => { if (name === "abort") active.delete(fn); remove(name, fn, opts); };
  const expected = principal();
  await withFetch(async () => response(expected), async () => {
    assert.deepEqual(await readVerifiedIdentitySession(origin, bearer, signal), expected);
    assert.equal(active.size, 0);
  });
});

test("persistent enrollment never returns the superseded session after rejected storage handoff", async () => {
  const refresh = Buffer.alloc(32, 39).toString("base64url");
  const observed = [];
  await withFetch(async (url, options) => {
    const path = new URL(url).pathname;
    observed.push([options.method, path, options.headers.Authorization]);
    if (path === "/v1/sessions/current") return response(principal());
    if (path === "/v1/sessions/persistent") return response({ refreshToken: refresh, refreshExpiresAt: expires() }, 201);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }, async () => {
    await rejectsAs(() => readPersistentIdentityRole(origin, bearer, null, "customer",
      new AbortController().signal, async () => assert.fail("unexpected rotation"), async () => false),
    0, "OWNER_RESPONSE_STALE");
  });
  assert.deepEqual(observed, [
    ["GET", "/v1/sessions/current", "Bearer " + bearer],
    ["POST", "/v1/sessions/persistent", "Bearer " + bearer],
    ["DELETE", "/v1/sessions/refresh", "Bearer " + refresh],
  ]);
});

test("persistent enrollment interrupted after dispatch rejects a cancelled view", async () => {
  const controller = new AbortController();
  let requests = 0;
  await withFetch(async (url) => {
    requests++;
    if (new URL(url).pathname === "/v1/sessions/current") return response(principal());
    controller.abort();
    throw new Error("interrupted transport");
  }, () => rejectsAs(() => readPersistentIdentityRole(origin, bearer, null, "customer", controller.signal,
    async () => assert.fail("unexpected rotation"), async () => assert.fail("unexpected handoff")),
  0, "OWNER_RESPONSE_STALE"));
  assert.equal(requests, 2);
});

for (const rotated of [false, true]) {
  test("uncertain persistent storage write revokes the received credential: rotated=" + rotated, async () => {
    const previous = Buffer.alloc(32, 35).toString("base64url");
    const next = Buffer.alloc(32, 39).toString("base64url");
    const storageFailure = new IdentityClientError(0, "OWNER_RESPONSE_STALE");
    const revoked = [];
    await withFetch(async (url, options) => {
      const path = new URL(url).pathname;
      if (path === "/v1/sessions/current") {
        return rotated ? response({ error: "UNAUTHORIZED" }, 401) : response(principal());
      }
      if (options.method === "DELETE") {
        revoked.push(options.headers.Authorization);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      if (rotated) return response({ ...admission(), refreshToken: next, refreshExpiresAt: expires() });
      return response({ refreshToken: next, refreshExpiresAt: expires() }, 201);
    }, () => assert.rejects(() => readPersistentIdentityRole(origin, bearer, rotated ? previous : null, "customer",
      new AbortController().signal, async () => {}, async () => { throw storageFailure; }),
    error => error === storageFailure));
    assert.deepEqual(revoked, ["Bearer " + next]);
  });
}

test("optional enrollment outage or conflict preserves only an uncancelled, already verified current session", async () => {
  for (const outcome of ["network", 409, 503]) {
    const current = principal();
    await withFetch(async (url) => {
      if (new URL(url).pathname === "/v1/sessions/current") return response(current);
      if (outcome === "network") throw new Error("unavailable");
      return response({ error: outcome === 409 ? "CONFLICT" : "OWNER_UNAVAILABLE" }, outcome);
    }, async () => assert.deepEqual(await readPersistentIdentityRole(origin, bearer, null, "customer",
      new AbortController().signal, async () => assert.fail("unexpected rotation"),
      async () => assert.fail("unexpected handoff")), { session: current, bearer }));
  }
});

test("successful persistent enrollment acknowledges the exact received refresh credential", async () => {
  const next = Buffer.alloc(32, 39).toString("base64url");
  const current = principal();
  let committed = 0;
  await withFetch(async (url) => new URL(url).pathname === "/v1/sessions/current" ? response(current) :
    response({ refreshToken: next, refreshExpiresAt: expires() }, 201), async () => {
    const result = await readPersistentIdentityRole(origin, bearer, null, "customer",
      new AbortController().signal, async () => assert.fail("unexpected rotation"), async (issued, before, rotated) => {
        assert.deepEqual(issued, { accessToken: bearer, refreshToken: next });
        assert.equal(before, bearer);
        assert.equal(rotated, false);
        committed++;
        return true;
      });
    assert.deepEqual(result, { session: current, bearer });
  });
  assert.equal(committed, 1);
});


test("fresh access avoids mutation; denied or wrong-role sessions cannot enroll", async () => {
  const refresh = Buffer.alloc(32, 35).toString("base64url");
  const signal = new AbortController().signal;
  const noWrite = async () => assert.fail("unexpected mutation");
  const current = principal();
  const run = (token = refresh) => readPersistentIdentityRole(origin, bearer, token, "customer", signal, noWrite, noWrite);
  await withFetch(async (_url, options) => {
    assert.equal(options.method, "GET");
    return response(current);
  }, async () => assert.deepEqual(await run(), { session: current, bearer }));
  await withFetch(async () => response({ ...current, role: "merchant" }), () => rejectsAs(run, 403, "FORBIDDEN"));
  await withFetch(async () => response({ error: "UNAUTHORIZED" }, 401), () => rejectsAs(() => run(null), 401, "UNAUTHORIZED"));
  await withFetch(async () => response({ error: "OWNER_UNAVAILABLE" }, 503), () => rejectsAs(run, 503, "OWNER_UNAVAILABLE"));
});

test("definitive enrollment denial and malformed receipts cannot return an old session", async () => {
  const signal = new AbortController().signal;
  for (const result of [
    () => response({ error: "UNAUTHORIZED" }, 401),
    () => response(null, 201), () => response([], 201), () => response("invalid", 201),
    () => response({ refreshToken: 42, refreshExpiresAt: expires() }, 201),
    () => response({ refreshToken: bearer }, 201),
  ]) {
    await withFetch(async (url) => new URL(url).pathname === "/v1/sessions/current" ? response(principal()) : result(),
      () => assert.rejects(() => readPersistentIdentityRole(origin, bearer, null, "customer", signal,
        async () => assert.fail("unexpected rotation"), async () => assert.fail("unexpected handoff")),
      error => error instanceof IdentityClientError && [401, 502].includes(error.status)));
  }
});

test("an acknowledged enrollment cannot expose an aborted or expired session", async () => {
  const next = Buffer.alloc(32, 39).toString("base64url");
  for (const reason of ["cancel", "expire"]) {
    const controller = new AbortController();
    const current = principal();
    const realNow = Date.now;
    try {
      await withFetch(async (url) => new URL(url).pathname === "/v1/sessions/current" ? response(current) :
        response({ refreshToken: next, refreshExpiresAt: expires() }, 201), () =>
        rejectsAs(() => readPersistentIdentityRole(origin, bearer, null, "customer", controller.signal,
          async () => assert.fail("unexpected rotation"), async () => {
            if (reason === "cancel") controller.abort();
            else Date.now = () => Date.parse(current.sessionExpiresAt) + 1;
            return true;
          }), reason === "cancel" ? 0 : 401, reason === "cancel" ? "OWNER_RESPONSE_STALE" : "UNAUTHORIZED"));
    } finally { Date.now = realNow; }
  }
});

test("rotation reads the exact actor and role; disagreement never exposes the result", async () => {
  const previous = Buffer.alloc(32, 35).toString("base64url");
  const next = Buffer.alloc(32, 39).toString("base64url");
  const current = { ...principal(), sessionExpiresAt: new Date(Date.now() + 30_000).toISOString() };
  for (const result of ["same", "different actor", "different role", "revocation outage", "expired access"]) {
    const valid = ["same", "expired access"].includes(result);
    const verified = { ...principal(), ...(result === "different role" ? { role: "merchant" } :
      valid ? {} : { actorId: "another-actor" }) };
    const trace = [];
    await withFetch(async (url, options) => {
      const path = new URL(url).pathname;
      const auth = options.headers.Authorization;
      if (options.method === "DELETE") {
        trace.push("revoke");
        assert.equal(auth, "Bearer " + next);
        if (result === "revocation outage") throw new Error("owner unavailable");
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      if (path === "/v1/sessions/current") {
        trace.push(auth === "Bearer " + bearer ? "current" : "readback");
        if (auth === "Bearer " + bearer) return result === "expired access" ? response({error:"UNAUTHORIZED"},401) : response(current);
        assert.equal(auth, "Bearer " + rotatedBearer);
        return response(verified);
      }
      trace.push("rotate");
      assert.equal(auth, "Bearer " + previous);
      return response({ ...admission(), refreshToken: next, refreshExpiresAt: expires() });
    }, async () => {
      const run = () => readPersistentIdentityRole(origin, bearer, previous, "customer", new AbortController().signal,
        async () => { trace.push("quarantine"); }, async (issued, before, rotated) => {
          trace.push("handoff");
          assert.equal(issued.refreshToken, next);
          assert.equal(before, bearer);
          assert.equal(rotated, true);
          return true;
        });
      if (valid) assert.deepEqual(await run(), { session: verified, bearer: rotatedBearer });
      else await rejectsAs(run, 502, "OWNER_RESPONSE_INVALID");
    });
    assert.deepEqual(trace, ["current", "quarantine", "rotate", "handoff", "readback", ...(valid ? [] : ["revoke"])]);
  }
});

test("a rejected storage handoff remains rejected during cleanup outage; failed quarantine never rotates", async () => {
  const refresh = Buffer.alloc(32, 35).toString("base64url");
  const next = Buffer.alloc(32, 39).toString("base64url");
  const signal = new AbortController().signal;
  let calls = 0;
  await withFetch(async (_url, options) => {
    calls++;
    if (options.method === "GET") return response(principal());
    if (options.method === "DELETE") throw new Error("cleanup unavailable");
    return response({ refreshToken: next, refreshExpiresAt: expires() }, 201);
  }, () => rejectsAs(() => readPersistentIdentityRole(origin, bearer, null, "customer", signal,
    async () => assert.fail("unexpected rotation"), async () => false), 0, "OWNER_RESPONSE_STALE"));
  assert.equal(calls, 3);
  await withFetch(async (_url, options) => {
    assert.equal(options.method, "GET");
    return response({ error: "UNAUTHORIZED" }, 401);
  }, () => rejectsAs(() => readPersistentIdentityRole(origin, bearer, refresh, "customer", signal,
    async () => { throw new IdentityClientError(0, "OWNER_RESPONSE_STALE"); },
    async () => assert.fail("unexpected handoff")), 0, "OWNER_RESPONSE_STALE"));
});

test("an unresponsive rotation times out once without retry or credential handoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const refresh = Buffer.alloc(32, 35).toString("base64url");
  const started = Promise.withResolvers();
  let rotations = 0;
  await withFetch(async (_url, options) => {
    if (options.method === "GET") return response({ error: "UNAUTHORIZED" }, 401);
    rotations++;
    started.resolve();
    return new Promise(() => {});
  }, async () => {
    const result = rejectsAs(() => readPersistentIdentityRole(origin, bearer, refresh, "customer",
      new AbortController().signal, async () => {}, async () => assert.fail("unexpected handoff")),
    0, "OPERATION_RESULT_UNKNOWN");
    await started.promise;
    t.mock.timers.tick(10_000);
    await result;
  });
  assert.equal(rotations, 1);
});
