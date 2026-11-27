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
    assert.equal(options.signal.aborted, false);
    controller.abort();
    assert.equal(options.signal.aborted, true);
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
  const current = new AbortController();
  const denied = new Response(new ReadableStream({ pull(stream) { current.abort(); stream.enqueue(new TextEncoder().encode(JSON.stringify({ error: "UNAUTHORIZED" }))); stream.close(); } }, { highWaterMark: 0 }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  await withFetch(async () => denied,
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer, current.signal),
      0, "OWNER_RESPONSE_STALE"));

  const cancelledPost = new AbortController();
  const failed = new Response(new ReadableStream({ pull(stream) { cancelledPost.abort(); stream.enqueue(new TextEncoder().encode(JSON.stringify({ error: "VERIFICATION_REQUIRED" }))); stream.close(); } }, { highWaterMark: 0 }), {
    status: 403,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
      if (options.headers.Authorization === "Bearer " + rotatedBearer) {
        assert.equal(options.signal.aborted, false);
        return response(principal());
      }
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
  let ownerSignal;
  let calls = 0;
  await withFetch((_url, opts) => {
    calls++;
    if (calls === 1) { ownerSignal = opts.signal; assert.equal(ownerSignal.aborted, false); started.resolve(); return stalled.promise; }
    return Promise.resolve(response(principal()));
  }, async () => {
    await expectPromptCancellation(() => readPersistentIdentityRole(origin, bearer, rotatedBearer, "customer",
      controller.signal, async () => assert.fail("must not rotate"), async () => assert.fail("must not commit")),
      started.promise, controller, "OWNER_RESPONSE_STALE", () => stalled.resolve(response(principal())));
    assert.equal(ownerSignal.aborted, true);
    assert.equal((await readVerifiedIdentitySession(origin, bearer)).actorId, "actor-123");
    assert.equal(calls, 2);
  });
});

for (const status of [200, 401]) {
  test(`non-cooperative Identity body cancellation: ${status}`, async () => {
    const controller = new AbortController(), stalled = Promise.withResolvers(), started = Promise.withResolvers();
    let cancelled = false;
    const res = new Response(new ReadableStream({ pull() { started.resolve(); return stalled.promise; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    await withFetch(async () => res, () => expectPromptCancellation(
      () => readVerifiedIdentitySession(origin, bearer, controller.signal), started.promise, controller,
      "OWNER_RESPONSE_STALE", () => stalled.reject(new Error("late bridge failure"))));
    assert.equal(cancelled, true);
    assert.equal(res.body.locked, false);
  });
}

test("non-cooperative Identity POST remains unknown and is not retried", async () => {
  const controller = new AbortController(), stalled = Promise.withResolvers(), started = Promise.withResolvers();
  let ownerSignal;
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
        return rotated && options.headers.Authorization === "Bearer " + bearer ? response({ error: "UNAUTHORIZED" }, 401) : response(principal());
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
    assert.deepEqual(trace, ["current", "quarantine", "rotate", "readback", ...(valid ? ["handoff"] : ["revoke"])]);
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

test("unverified rotation never releases quarantine even if revocation fails", async () => {
  const previous = Buffer.alloc(32, 35).toString("base64url");
  const next = Buffer.alloc(32, 39).toString("base64url");
  const current = { ...principal(), sessionExpiresAt: new Date(Date.now() + 30_000).toISOString() };
  for (const outcome of ["actor", "role", "outage"]) {
    let quarantine = false;
    let published = null;
    let revocations = 0;
    await withFetch(async (url, options) => {
      if (options.method === "DELETE") { revocations++; throw new Error("revocation unavailable"); }
      if (options.method === "POST") return response({ ...admission(), refreshToken: next, refreshExpiresAt: expires() });
      if (options.headers.Authorization === "Bearer " + bearer) return response(current);
      if (outcome === "outage") throw new Error("readback unavailable");
      return response({ ...principal(), ...(outcome === "actor" ? { actorId: "another-actor" } : { role: "merchant" }) });
    }, async () => {
      await assert.rejects(() => readPersistentIdentityRole(origin, bearer, previous, "customer",
        new AbortController().signal, async () => { quarantine = true; },
        async credentials => { published = credentials; quarantine = false; return true; }));
      assert.equal(published, null, outcome);
      assert.equal(quarantine, true, outcome);
      assert.equal(revocations, 1, outcome);
    });
  }
});

test("Identity aborts oversized success and denial streams before buffering the response", async () => {
  for (const status of [200, 401, 201]) {
    let pulls = 0, cancelled = false;
    const initial = new TextEncoder().encode(JSON.stringify(status === 200 ? principal() :
      status === 201 ? admission() : { error: "UNAUTHORIZED" }));
    const stream = new ReadableStream({
      pull(controller) {
        pulls++;
        if (pulls === 1) controller.enqueue(initial);
        else if (pulls <= 12) controller.enqueue(new Uint8Array(4096).fill(32));
        else controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const res = new Response(stream, {status, headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
    }});
    await withFetch(async () => res, () => status === 201 ?
      rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN") :
      rejectsAs(() => readVerifiedIdentitySession(origin, bearer), status === 200 ? 502 : 401,
        status === 200 ? "OWNER_RESPONSE_INVALID" : "OWNER_REQUEST_FAILED"));
    assert.ok(cancelled, "oversized stream must be cancelled, status " + status);
    assert.ok(pulls < 12, "must not read remaining oversized response");
    assert.equal(res.body.locked, false);
  }
});

test("Identity measures UTF-8 bytes and rejects malformed encoding", async () => {
  // Non-ASCII padding inside a JSON string in a denial would otherwise be
  // parsed as an allowlisted rejection despite crossing the owner byte cap.
  const denial = { error: "UNAUTHORIZED", detail: "ع".repeat(9000) };
  await withFetch(async () => response(denial, 401),
    () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 401, "OWNER_REQUEST_FAILED"));
  const malformed = new Uint8Array([...new TextEncoder().encode('{"actorId":"a'), 0xff,
    ...new TextEncoder().encode('","role":"customer","sessionExpiresAt":"' + expires() + '"}')]);
  await withFetch(async () => new Response(malformed, { headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  } }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
});

test("Identity stops stalled bodies on an absolute deadline and releases the reader", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const status of [200, 401, 201]) {
    const started = Promise.withResolvers();
    let cancelled = false;
    const res = new Response(new ReadableStream({
      pull() { started.resolve(); return new Promise(() => {}); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { status, headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
    } });
    await withFetch(async () => res, async () => {
      const pending = status === 201 ?
        rejectsAs(() => admitCurrentCustomerAsMerchant(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN") :
        rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 0, "OWNER_NETWORK_UNAVAILABLE");
      await started.promise;
      t.mock.timers.tick(5_000);
      await pending;
    });
    assert.equal(cancelled, true);
    assert.equal(res.body.locked, false);
  }
});

test("Identity rejects absent streams, unsafe paths and declared oversize without a fallback read", async () => {
  const { ownerRequest } = await import("./transport.ts");
  await withFetch(async () => assert.fail("unsafe request dispatched"), async () => {
    for (const path of ["https://elsewhere.test/session", "//elsewhere.test/session", "/\\elsewhere.test/session"]) {
      await rejectsAs(() => ownerRequest(origin, path, bearer, "GET", 200), 0, "IDENTITY_ENDPOINT_UNSAFE");
    }
  });
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  await withFetch(async () => ({ status: 200, ok: true, headers, body: null,
    text: () => assert.fail("unbounded text fallback"), json: () => assert.fail("unbounded JSON fallback"),
  }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  for (const status of [200, 202]) {
    let cancelled = false;
    const res = new Response(new ReadableStream({
      pull() { assert.fail("rejected body must not be consumed"); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { status, headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": "16385",
    } });
    await withFetch(async () => res,
      () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
    assert.equal(cancelled, true);
  }
});

test("Identity accepts valid split UTF-8 at the exact byte limit", async () => {
  const expected = { ...principal(), actorId: "ع" };
  const encoder = new TextEncoder();
  const bytes = encoder.encode(JSON.stringify(expected));
  const padded = new Uint8Array(16384).fill(32);
  padded.set(bytes);
  const split = bytes.indexOf(0xd8) + 1;
  assert.ok(split > 0);
  const res = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(padded.subarray(0, split));
      controller.enqueue(padded.subarray(split));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  await withFetch(async () => res, async () => {
    assert.deepEqual(await readVerifiedIdentitySession(origin, bearer), expected);
  });
  assert.equal(res.body.locked, false);
});

test("Identity cleanup rejection cannot replace the authoritative failure", async () => {
  for (const headers of [
    { "Content-Type": "text/html", "Cache-Control": "no-store" },
    { "Content-Type": "application/json", "Cache-Control": "no-store" },
  ]) {
    let cancelled = false;
    const res = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(16385)); },
      cancel() { cancelled = true; return Promise.reject(new Error("cleanup failed")); },
    }, { highWaterMark: 0 }), { headers });
    await withFetch(async () => res,
      () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
    assert.equal(cancelled, true);
    assert.equal(res.body.locked, false);
  }
});

test("Identity discard protects against a synchronous native bridge failure", async () => {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  await withFetch(async () => ({
    status: 202, ok: true, headers,
    get body() { throw new Error("native body accessor failed"); },
  }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  let released = false;
  await withFetch(async () => ({
    status: 200, ok: true, headers,
    body: { getReader() { return {
      read: async () => ({ done: false, value: new Uint8Array(16385) }),
      cancel() { throw new Error("native cancel failed"); },
      releaseLock() { released = true; },
    }; } },
  }), () => rejectsAs(() => readVerifiedIdentitySession(origin, bearer), 502, "OWNER_RESPONSE_INVALID"));
  assert.equal(released, true);
});

test("optional persistent enrollment has a finite header deadline and does not publish a late grant", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const current = principal();
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const signal = new AbortController().signal;
  let calls = 0;
  let ownerSignal;
  await withFetch(async (url, options) => {
    calls++;
    if (new URL(url).pathname === "/v1/sessions/current") return response(current);
    ownerSignal = options.signal;
    started.resolve();
    return late.promise;
  }, async () => {
    let outcome;
    const pending = readPersistentIdentityRole(origin, bearer, null, "customer", signal,
      async () => assert.fail("unexpected rotation"), async () => assert.fail("late grant persisted"))
      .then(value => { outcome = { value }; }, error => { outcome = { error }; });
    await started.promise;
    try {
      t.mock.timers.tick(5000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(ownerSignal.aborted, true);
      assert.equal(signal.aborted, false);
      assert.deepEqual(outcome, { value: { session: current, bearer } });
    } finally {
      late.resolve(response({ refreshToken: rotatedBearer, refreshExpiresAt: expires() }, 201));
      await pending;
    }
  });
  assert.equal(calls, 2);
});

test("rotated refresh receipt that expires during owner verification never reaches durable handoff", async () => {
  const now = Date.now();
  const oldRefresh = Buffer.alloc(32, 35).toString("base64url");
  const newRefresh = Buffer.alloc(32, 39).toString("base64url");
  const current = { ...principal(), sessionExpiresAt: new Date(now + 30_000).toISOString() };
  const receipt = { ...admission(), refreshToken: newRefresh, refreshExpiresAt: new Date(now + 1000).toISOString() };
  const realNow = Date.now;
  let handoffs = 0;
  let cleanup = 0;
  try {
    Date.now = () => now;
    await withFetch(async (_url, options) => {
      if (options.method === "DELETE") {
        assert.equal(options.headers.Authorization, "Bearer " + newRefresh);
        cleanup++;
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
      if (options.method === "POST") return response(receipt);
      if (options.headers.Authorization === "Bearer " + bearer) return response(current);
      Date.now = () => now + 1001;
      return response(principal());
    }, () => rejectsAs(() => readPersistentIdentityRole(origin, bearer, oldRefresh, "customer",
      new AbortController().signal, async () => {}, async () => { handoffs++; return true; }),
      502, "OPERATION_RESULT_UNKNOWN"));
  } finally { Date.now = realNow; }
  assert.equal(handoffs, 0);
  assert.equal(cleanup, 1);
});

test("persistent current read deadline fails as an outage without consuming a refresh credential", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const caller = new AbortController();
  let requests = 0;
  let ownerSignal;
  await withFetch(async (_url, options) => {
    requests++;
    assert.equal(options.method, "GET");
    ownerSignal = options.signal;
    started.resolve();
    return late.promise;
  }, async () => {
    let outcome;
    const pending = readPersistentIdentityRole(origin, bearer, rotatedBearer, "customer", caller.signal,
      async () => assert.fail("outage must not rotate"), async () => assert.fail("outage must not persist"))
      .then(value => { outcome = value; }, error => { outcome = error; });
    await started.promise;
    try {
      t.mock.timers.tick(5000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(ownerSignal.aborted, true);
      assert.equal(caller.signal.aborted, false);
      assert.ok(outcome instanceof IdentityClientError);
      assert.equal(outcome.status, 0);
      assert.equal(outcome.code, "OWNER_NETWORK_UNAVAILABLE");
    } finally { late.resolve(response(principal())); await pending; }
  });
  assert.equal(requests, 1);
});

test("persistent handoff rejects expiry of the issued access receipt and the verified principal", async () => {
  const now = Date.now();
  const next = Buffer.alloc(32, 39).toString("base64url");
  const previous = Buffer.alloc(32, 35).toString("base64url");
  for (const expired of ["issued access", "verified principal"]) {
    const actualNow = Date.now;
    let cleanup = 0;
    let handoffs = 0;
    try {
      Date.now = () => now;
      const current = { ...principal(), sessionExpiresAt: new Date(now + 30_000).toISOString() };
      const issued = { ...admission(), refreshToken: next, refreshExpiresAt: expires(),
        sessionExpiresAt: new Date(now + (expired === "issued access" ? 1000 : 60_000)).toISOString() };
      await withFetch(async (_url, options) => {
        if (options.method === "DELETE") {
          cleanup++;
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        if (options.method === "POST") return response(issued);
        if (options.headers.Authorization === "Bearer " + bearer) return response(current);
        if (expired === "issued access") {
          Date.now = () => now + 1001;
          return response(principal());
        }
        // Keep the expiry valid through the transport parser, then expire
        // immediately before the durable handoff admission recheck.
        let reads = 0;
        Date.now = () => ++reads === 1 ? now : now + 1001;
        return response({ ...principal(), sessionExpiresAt: new Date(now + 1000).toISOString() });
      }, async () => {
        await assert.rejects(() => readPersistentIdentityRole(origin, bearer, previous, "customer",
          new AbortController().signal, async () => {}, async () => { handoffs++; return true; }),
        error => error instanceof IdentityClientError);
      });
    } finally { Date.now = actualNow; }
    assert.equal(handoffs, 0, expired);
    assert.equal(cleanup, 1, expired);
  }
});

test("pre-cancelled persistent operations never dispatch or consume credentials", async () => {
  const caller = new AbortController();
  caller.abort();
  await withFetch(async () => assert.fail("cancelled persistent operation dispatched"), async () => {
    await rejectsAs(() => establishPersistentIdentitySession(origin, bearer, caller.signal), 0, "OPERATION_RESULT_UNKNOWN");
    await rejectsAs(() => rotatePersistentIdentitySession(origin, rotatedBearer, caller.signal), 0, "OPERATION_RESULT_UNKNOWN");
    await rejectsAs(() => revokePersistentIdentitySession(origin, rotatedBearer, caller.signal), 0, "OPERATION_RESULT_UNKNOWN");
    await rejectsAs(() => readPersistentIdentityRole(origin, bearer, rotatedBearer, "customer", caller.signal,
      async () => assert.fail("cancelled rotation"), async () => assert.fail("cancelled handoff")), 0, "OWNER_RESPONSE_STALE");
  });
});

test("ordinary Identity operations have bounded headers, stable uncertainty and no late body admission", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cases = [
    [() => readVerifiedIdentitySession(origin, bearer), 5000, "OWNER_NETWORK_UNAVAILABLE"],
    [() => issueCustomerPhoneChallenge(origin, "+967770000001"), 10000, "OPERATION_RESULT_UNKNOWN"],
    [() => verifyCustomerPhoneChallenge(origin, "a".repeat(48), "123456"), 10000, "OPERATION_RESULT_UNKNOWN"],
    [() => admitCurrentCustomerAsMerchant(origin, bearer), 10000, "OPERATION_RESULT_UNKNOWN"],
    [() => reviewOriginalOperatorPermissions(origin, bearer, "operator-target"), 10000, "OWNER_NETWORK_UNAVAILABLE"],
    [() => changeOriginalOperatorPermission(origin, bearer, "operator-target", "operations",
      { state: "ACTIVE", expectedVersion: 0, operationId: "command-123", reason: "test" }), 10000, "OPERATION_RESULT_UNKNOWN"],
    [() => revokeVerifiedIdentitySession(origin, bearer), 10000, "OPERATION_RESULT_UNKNOWN"],
  ];
  for (const [call, ms, code] of cases) {
    const started = Promise.withResolvers(), late = Promise.withResolvers();
    let ownerSignal, outcome, cancelled = false;
    let requests = 0;
    const reply = new Response(new ReadableStream({
      pull() { assert.fail("late reply must not be read"); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    await withFetch(async (_url, options) => {
      requests++;
      ownerSignal = options.signal;
      started.resolve();
      return late.promise;
    }, async () => {
      const pending = call().then(value => { outcome = value; }, error => { outcome = error; });
      await Promise.race([started.promise, pending]);
      try {
        assert.equal(requests, 1);
        t.mock.timers.tick(ms);
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(outcome instanceof IdentityClientError, "headers must settle within the deadline");
        assert.equal(outcome.status, 0);
        assert.equal(outcome.code, code);
        assert.equal(ownerSignal.aborted, true);
      } finally {
        late.resolve(reply);
        await pending;
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cancelled, true);
      assert.equal(reply.body.locked, false);
      assert.equal(requests, 1);
    });
  }
});

test("current-session header and body consume one absolute request budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = Promise.withResolvers(), bodyStarted = Promise.withResolvers(), requestStarted = Promise.withResolvers();
  let cancelled = false, ownerSignal, outcome;
  const reply = new Response(new ReadableStream({
    pull() { bodyStarted.resolve(); return new Promise(() => {}); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const caller = new AbortController();
  await withFetch(async (_url, options) => { ownerSignal = options.signal; requestStarted.resolve(); return headers.promise; }, async () => {
    const pending = readVerifiedIdentitySession(origin, bearer, caller.signal).then(value => { outcome = value; }, error => { outcome = error; });
    await requestStarted.promise;
    t.mock.timers.tick(4000);
    headers.resolve(reply);
    await bodyStarted.promise;
    try {
      t.mock.timers.tick(1000);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(outcome instanceof IdentityClientError, "body cannot restart the request budget");
      assert.equal(outcome.code, "OWNER_NETWORK_UNAVAILABLE");
      assert.equal(ownerSignal.aborted, true);
      assert.equal(caller.signal.aborted, false);
    } finally { caller.abort(); await pending; }
  });
  assert.equal(cancelled, true);
  assert.equal(reply.body.locked, false);
});

test("both Identity revocation paths reject contradictory empty owner receipts", async () => {
  const operations = [
    () => revokeVerifiedIdentitySession(origin, bearer),
    () => revokePersistentIdentitySession(origin, rotatedBearer),
  ];
  for (const operation of operations) {
    for (const headers of [
      { "Cache-Control": "no-store", "Content-Length": "1" },
      { "Cache-Control": "no-store", "Transfer-Encoding": "chunked" },
      { "Cache-Control": "no-store", "Content-Length": "0, 1" },
    ]) {
      await withFetch(async () => new Response(null, { status: 204, headers }),
        () => rejectsAs(operation, 502, "OPERATION_RESULT_UNKNOWN"));
    }
    let cancelled = 0;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled++; },
    }, { highWaterMark: 0 });
    await withFetch(async () => ({
      status: 204, ok: true, headers: new Headers({ "Cache-Control": "no-store" }), body,
    }), () => rejectsAs(operation, 502, "OPERATION_RESULT_UNKNOWN"));
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
    await withFetch(async () => new Response(null, {
      status: 204, headers: { "Cache-Control": "no-store", "Content-Length": "0" },
    }), operation);
    const empty = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(0));
      controller.close();
    } });
    await withFetch(async () => ({
      status: 204, ok: true, headers: new Headers({ "Cache-Control": "no-store" }), body: empty,
    }), operation);
    assert.equal(empty.locked, false);
  }
});

test("Identity empty stream cannot extend the owner request deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const started = Promise.withResolvers();
  const body = new ReadableStream({
    pull() { started.resolve(); return new Promise(() => {}); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await withFetch(async () => ({
    status: 204, ok: true, headers: new Headers({ "Cache-Control": "no-store" }), body,
  }), async () => {
    const pending = rejectsAs(() => revokeVerifiedIdentitySession(origin, bearer), 502, "OPERATION_RESULT_UNKNOWN");
    await started.promise;
    t.mock.timers.tick(5000);
    await pending;
  });
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
