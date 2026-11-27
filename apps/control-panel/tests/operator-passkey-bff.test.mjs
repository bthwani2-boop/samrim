import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundedRequestBody,
  canonicalOperatorEntryRedirect,
  cookieLifetimeSeconds,
  isEmptyRequestBody,
  isTrustedOperatorLoopbackTarget,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  parseInitialOperatorOptions,
  parseIssuedOperatorToken,
  parsePasskeyOptions,
  parseVerifiedOperatorPrincipal,
  resolveInitialOperatorBootstrapConfig,
  resolveIsolatedOperatorConfig,
  validAssertion,
  validInitialOperatorPayload,
} from "../src/server/operator-passkey-bff.ts";

const goodEnv = {
  BTHWANI_ISOLATED_TEST_MODE: "true",
  OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
  OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:13000",
  OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:18110",
};
const now = Date.parse("2026-11-18T12:00:00Z");
const token = "A".repeat(43);

test("Operator entry canonicalizes the loopback alias without widening WebAuthn scope", () => {
  assert.equal(canonicalOperatorEntryRedirect("127.0.0.1:13000"), "http://localhost:13000/");
  for (const host of ["localhost:13000", "127.0.0.1:23010", "localhost:23100", "evil.example:13000", null]) {
    assert.equal(canonicalOperatorEntryRedirect(host), null);
  }
});

test("Operator browser BFF is opt-in and bound to exact local origins", () => {
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, BTHWANI_ISOLATED_TEST_MODE: "false" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "false" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://evil.localhost:13000" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_BROWSER_ORIGIN: "https://operator.example.com" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:13000/" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://internal.local:18110" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:18110@evil.example" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:18110/v1" }), null);
  assert.equal(resolveIsolatedOperatorConfig({ ...goodEnv, OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:18110?next=evil" }), null);
  assert.deepEqual(resolveIsolatedOperatorConfig(goodEnv), {
    browserOrigin: "http://localhost:13000", identityOrigin: "http://127.0.0.1:18110",
  });
  assert.equal(OPERATOR_COOKIE, "bthwani_operator_session");
});

test("browser mutations require exact same-origin Host and Origin, never client bearer", () => {
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const check = (headers, method = "POST") =>
    isTrustedOperatorRequest(new Request("http://localhost:13000/api/auth/passkey/options", { method, headers }), config);
  assert.equal(check({ origin: "http://localhost:13000", host: "localhost:13000" }), true);
  assert.equal(check({ origin: "http://localhost:13000", host: "localhost:13000", authorization: "Bearer forged" }), false);
  assert.equal(check({ origin: "http://localhost:13000", host: "localhost:13000", "x-actor-id": "root" }), false);
  assert.equal(check({ origin: "https://evil.example", host: "localhost:13000" }), false);
  assert.equal(check({ origin: "http://localhost:13000", host: "evil.example" }), false);
  assert.equal(check({ host: "localhost:13000" }), false);
  assert.equal(check({ origin: "null", host: "localhost:13000" }), false);
  assert.equal(check({ origin: "http://localhost:13000", host: "localhost:13000", "x-forwarded-host": "evil.example" }), false);
  assert.equal(check({ origin: "http://localhost:13000", host: "localhost:13000" }, "GET"), false);
  const patch = new Request("http://localhost:13000/api/operations/stores/store-a/availability", {
    method: "PATCH", headers: { origin: "http://localhost:13000", host: "localhost:13000" },
  });
  assert.equal(isTrustedOperatorRequest(patch, config, "PATCH"), true);
  assert.equal(isTrustedOperatorRequest(patch, config), false);
  patch.headers.set("origin", "http://127.0.0.1:13000");
  assert.equal(isTrustedOperatorRequest(patch, config, "PATCH"), false);
});

test("SSH control-panel tunnel has one exact internal origin without admitting forged browser origins", () => {
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const internal = "http://localhost:23010/api/auth/session";
  const valid = { host: "localhost:13000", origin: "http://localhost:13000" };
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(internal, { headers: valid }), config.browserOrigin), true);
  assert.equal(isTrustedOperatorRequest(new Request(internal, { method: "POST", headers: valid }), config), true);
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(internal, {
    headers: { host: "localhost:13000", "x-forwarded-host": "localhost:13000" },
  }), config.browserOrigin), true);
  for (const [url, headers] of [
    [internal, { ...valid, origin: "https://evil.example" }],
    [internal, { ...valid, host: "127.0.0.1:23010" }],
    [internal, { ...valid, "x-forwarded-host": "evil.example" }],
    [internal, { ...valid, authorization: "Bearer forged" }],
    ["http://127.0.0.1:28112/api/auth/session", valid],
    ["http://127.0.0.1:23010/api/auth/session", valid],
    ["http://localhost:23010/api/auth/session?x=1", valid],
  ]) {
    const req = new Request(url, { method: "POST", headers });
    assert.equal(isTrustedOperatorRequest(req, config), false, url);
  }
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(internal, { headers: valid }),
    "http://localhost:23100"), false);
  const captainList = "http://localhost:23010/api/captains?status=PENDING&limit=20";
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(captainList, { headers: valid }),
    config.browserOrigin), false, "auth endpoints must still reject query parameters by default");
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(captainList, { headers: valid }),
    config.browserOrigin, true), true, "Captain owner BFF accepts query after its own parameter validation");
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(captainList, {
    headers: { ...valid, host: "localhost:23010" },
  }), config.browserOrigin, true), false, "internal host cannot impersonate the browser");
  assert.equal(isTrustedOperatorLoopbackTarget(new Request(captainList, {
    headers: { ...valid, "x-forwarded-host": "evil.example" },
  }), config.browserOrigin, true), false, "forged forwarded host is rejected");
  assert.equal(isTrustedOperatorLoopbackTarget(new Request("http://127.0.0.1:23010/api/captains?status=PENDING", {
    headers: valid,
  }), config.browserOrigin, true), false, "only the exact pre-authorized SSH origin is allowed");
});

test("empty POST streams are valid logout requests, but bytes and transfer streams are rejected", async () => {
  const url = "http://localhost:13000/api/auth/session";
  const emptyStream = new Request(url, {
    method: "POST",
    body: new ReadableStream({ start(controller) { controller.close(); } }),
    duplex: "half",
  });
  assert.equal(await isEmptyRequestBody(emptyStream), true, "Next may expose zero-byte POST streams");
  assert.equal(await isEmptyRequestBody(new Request(url, { method: "POST" })), true);
  assert.equal(await isEmptyRequestBody(new Request(url, { method: "POST", body: "forged" })), false);
  const streamed = new Request(url, {
    method: "POST",
    body: new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(new TextEncoder().encode("unexpected"));
      controller.close();
    } }),
    duplex: "half",
  });
  assert.equal(await isEmptyRequestBody(streamed), false, "an empty first chunk is not an empty request");
  const declared = new Request(url, { method: "POST", headers: { "content-length": "3" } });
  assert.equal(await isEmptyRequestBody(declared), false);
});

test("stalled empty-body stream cannot hold the Operator logout endpoint indefinitely", { timeout: 3000 }, async () => {
  const stalled = new Request("http://localhost:13000/api/auth/session", {
    method: "POST",
    body: new ReadableStream({ start() { /* Deliberately never completes. */ } }),
    duplex: "half",
  });
  let deadline;
  try {
    const verdict = await Promise.race([
      isEmptyRequestBody(stalled),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Unbounded empty-body stream")), 1700);
      }),
    ]);
    assert.equal(verdict, false, "timeout must fail closed without contacting Identity");
  } finally {
    clearTimeout(deadline);
  }
});

test("stalled JSON assertion streams are rejected within a bounded deadline", { timeout: 4000 }, async () => {
  const request = new Request("http://localhost:13000/api/auth/passkey/authentication", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ceremonyId":'));
        // A malicious stream can stop transmitting without closing.
      },
    }),
    duplex: "half",
  });
  let deadline;
  try {
    const response = await Promise.race([
      boundedRequestBody(request),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Unbounded JSON assertion stream")), 2900);
      }),
    ]);
    assert.equal(response, null, "incomplete assertion must never be sent to Identity");
  } finally {
    clearTimeout(deadline);
  }
  const valid = '{"ceremonyId":"test"}';
  assert.equal(await boundedRequestBody(new Request("http://localhost:13000/api/auth/passkey/authentication", {
    method: "POST", body: valid,
  })), valid);
});

test("only strict WebAuthn required-UV options may reach browser", () => {
  const options = {
    ceremonyId: "B".repeat(43),
    options: { publicKey: { challenge: "C".repeat(43), rpId: "localhost", userVerification: "required" } },
  };
  assert.deepEqual(parsePasskeyOptions(options), options);
  assert.equal(parsePasskeyOptions({ ...options, ceremonyId: "bad" }), null);
  assert.equal(parsePasskeyOptions({ ...options, options: { publicKey: { ...options.options.publicKey, userVerification: "preferred" } } }), null);
  assert.equal(parsePasskeyOptions({ ...options, options: { publicKey: { ...options.options.publicKey, rpId: "example.com" } } }), null);
  assert.equal(parsePasskeyOptions({ ...options, options: { publicKey: { ...options.options.publicKey, challenge: "invalid==" } } }), null);
});

test("a canonical session is required before cookie issuance; forgery cannot select role", () => {
  const issued = { accessToken: token, sessionExpiresAt: "2026-11-18T12:30:00Z" };
  const principal = { actorId: "root-synthetic", role: "operator", sessionExpiresAt: issued.sessionExpiresAt };
  assert.deepEqual(parseIssuedOperatorToken(issued, now), issued);
  assert.deepEqual(parseVerifiedOperatorPrincipal(principal, issued, now), principal);
  assert.equal(parseVerifiedOperatorPrincipal({ ...principal, role: "merchant" }, issued, now), null);
  assert.equal(parseVerifiedOperatorPrincipal({ ...principal, sessionExpiresAt: "2026-11-18T12:31:00Z" }, issued, now), null);
  assert.equal(parseVerifiedOperatorPrincipal({ ...principal, actorId: "" }, issued, now), null);
  assert.equal(parseIssuedOperatorToken({ ...issued, accessToken: "forged" }, now), null);
  assert.equal(parseIssuedOperatorToken({ ...issued, sessionExpiresAt: "2026-11-18T11:59:59Z" }, now), null);
  assert.equal(parseIssuedOperatorToken({ ...issued, sessionExpiresAt: "2026-11-20T12:00:00Z" }, now), null);
  assert.equal(cookieLifetimeSeconds(issued.sessionExpiresAt, now), 1800);
  assert.equal(cookieLifetimeSeconds("2026-11-18T12:00:00Z", now), 0);
});


test("Operator assertion rejects additional keys and validates exact two-key shape without sorting", () => {
  const credential = { type: "public-key", id: "abc", rawId: "abc", response: {} };
  const ceremonyId = "B".repeat(43);
  assert.equal(validAssertion({ ceremonyId, credential }), true);
  assert.equal(validAssertion({ credential, ceremonyId }), true);
  assert.equal(validAssertion({ ceremonyId, credential, role: "operator" }), false);
  assert.equal(validAssertion({ ceremonyId, credential, __proto__: null, actorId: "root" }), false);
  assert.equal(validAssertion({ ceremonyId: "short", credential }), false);
  assert.equal(validAssertion({ ceremonyId, credential: { ...credential, type: "password" } }), false);
});

test("Operator workspace grants require fresh Identity session and seven owner permission decisions", async t => {
  const { readVerifiedOperatorAccess } = await import("../src/server/operator-passkey-bff.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
  const queried = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const path = new URL(url).pathname;
    queried.push(path);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    if (path === "/v1/sessions/current") {
      return Response.json({ actorId: "operator-one", role: "operator", sessionExpiresAt: expiry });
    }
    const permission = path.split("/").at(-1);
    if (permission === "operations" || permission === "merchant") {
      return Response.json({ actorId: "operator-one", permission });
    }
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  });
  assert.deepEqual(await readVerifiedOperatorAccess(config, token), {
    actorId: "operator-one", sessionExpiresAt: expiry, grants: ["operations", "merchant"],
  });
  assert.equal(queried.length, 8, "session and all seven finite permissions must be read");
});

test("Operator workspace owner mismatch, role spoof, revoked session and outage all fail closed", async t => {
  const { readOperatorAccessState, readVerifiedOperatorAccess } = await import("../src/server/operator-passkey-bff.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
  let mode = "different-actor";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    calls++;
    const path = new URL(url).pathname;
    if (path === "/v1/sessions/current") {
      if (mode === "revoked") return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
      if (mode === "role-spoof") return Response.json({ actorId: "operator-one", role: "merchant", sessionExpiresAt: expiry });
      if (mode === "outage") return Response.json({ error: "OWNER_UNAVAILABLE" }, { status: 503 });
      return Response.json({ actorId: "operator-one", role: "operator", sessionExpiresAt: expiry });
    }
    const permission = path.split("/").at(-1);
    if (mode === "no-grants") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    if (mode === "revoked-during-read") return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    return Response.json({
      actorId: mode === "different-actor" ? "operator-two" : "operator-one", permission,
      ...(mode === "extra-field" ? { granted: false } : {}),
    });
  });
  for (mode of ["different-actor", "role-spoof", "revoked", "outage", "extra-field"]) {
    assert.equal(await readVerifiedOperatorAccess(config, token), null, mode);
  }
  for (mode of ["different-actor", "outage", "extra-field"]) {
    assert.deepEqual(await readOperatorAccessState(config, token), { status: "unavailable" }, mode);
  }
  for (mode of ["role-spoof", "revoked", "revoked-during-read"]) {
    assert.deepEqual(await readOperatorAccessState(config, token), { status: "signed-out" }, mode);
  }
  mode = "no-grants";
  assert.deepEqual(await readOperatorAccessState(config, token), {
    status: "verified", access: { actorId: "operator-one", sessionExpiresAt: expiry, grants: [] },
  });
  const before = calls;
  assert.equal(await readVerifiedOperatorAccess(config, "forged"), null);
  assert.equal(calls, before, "malformed cookie cannot trigger Identity calls");
});
test("Root bootstrap requires a distinct opt-in and the canonical localhost origin", () => {
  const enabled = { ...goodEnv, OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF: "true" };
  const surface = { ...enabled, BTHWANI_SURFACE_PREVIEW: "1",
    OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:23100" };
  assert.equal(resolveInitialOperatorBootstrapConfig(goodEnv), null);
  assert.equal(resolveInitialOperatorBootstrapConfig(enabled)?.browserOrigin, "http://localhost:13000");
  assert.equal(resolveInitialOperatorBootstrapConfig(surface), null);
  assert.equal(resolveInitialOperatorBootstrapConfig({ ...surface, BTHWANI_SURFACE_PREVIEW: "0" }), null);
  assert.equal(resolveInitialOperatorBootstrapConfig({
    ...surface, OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:13000",
  })?.browserOrigin, "http://localhost:13000");
  assert.equal(resolveInitialOperatorBootstrapConfig({
    ...surface, BTHWANI_ISOLATED_TEST_MODE: "false",
  }), null);
  assert.equal(resolveIsolatedOperatorConfig(surface), null);
});

test("retired Surface setting cannot rename Operator session or refresh cookies", async t => {
  const previous = process.env.BTHWANI_SURFACE_PREVIEW;
  t.after(() => {
    if (previous === undefined) delete process.env.BTHWANI_SURFACE_PREVIEW;
    else process.env.BTHWANI_SURFACE_PREVIEW = previous;
  });
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  const config = await import("../src/server/operator-passkey-config.ts?retired-surface");
  assert.equal(config.OPERATOR_COOKIE, "bthwani_operator_session");
  assert.equal(config.OPERATOR_REFRESH_COOKIE, "bthwani_operator_refresh");
});

test("Root registration payloads can never supply an actor, role or permission", () => {
  const proof="A".repeat(43);
  const ceremonyId="B".repeat(43);
  const credential={type:"public-key",id:"abc",rawId:"abc",response:{}};
  assert.equal(validInitialOperatorPayload({proof},false),true);
  assert.equal(validInitialOperatorPayload({proof,actorId:"root"},false),false);
  assert.equal(validInitialOperatorPayload({proof,role:"operator"},false),false);
  assert.equal(validInitialOperatorPayload({proof,permissions:["finance"]},false),false);
  assert.equal(validInitialOperatorPayload({proof,ceremonyId,credential},true),true);
  assert.equal(validInitialOperatorPayload({proof,ceremonyId,credential,role:"operator"},true),false);
  assert.equal(validInitialOperatorPayload({proof,ceremonyId,credential:{...credential,type:"password"}},true),false);
  assert.equal(validInitialOperatorPayload({proof:"bad"},false),false);
});

test("Root Passkey options require resident user-verified localhost WebAuthn RP", () => {
  const valid={
    ceremonyId:"A".repeat(43),
    options:{publicKey:{
      challenge:"B".repeat(43),rp:{id:"localhost",name:"BThwani Operator"},
      user:{id:"C".repeat(43),name:"Owner",displayName:"Owner"},
      authenticatorSelection:{residentKey:"required",userVerification:"required"},
    }},
  };
  assert.deepEqual(parseInitialOperatorOptions(valid),valid);
  assert.equal(parseInitialOperatorOptions({...valid,ceremonyId:"bad"}),null);
  assert.equal(parseInitialOperatorOptions({...valid,options:{publicKey:{
    ...valid.options.publicKey,rp:{id:"evil.example"},
  }}}),null);
  assert.equal(parseInitialOperatorOptions({...valid,options:{publicKey:{
    ...valid.options.publicKey,authenticatorSelection:{residentKey:"preferred",userVerification:"required"},
  }}}),null);
});

test("Operator principal and token obey exact Identity response schemas", () => {
  const issued = { accessToken: token, sessionExpiresAt: "2026-11-18T12:30:00Z" };
  const principal = { actorId: "root-synthetic", role: "operator", sessionExpiresAt: issued.sessionExpiresAt };
  assert.equal(parseIssuedOperatorToken({ ...issued, debug: "internal" }, now), null,
    "Identity's additionalProperties=false must fail closed");
  assert.equal(parseVerifiedOperatorPrincipal({ ...principal, debug: true }, issued, now), null);
  for (const actorId of [" leading", "trailing ", "root\nother", "root\u0000other",
    "root\u007fother", "x".repeat(129), "م".repeat(65), "\ud800"]) {
    assert.equal(parseVerifiedOperatorPrincipal({ ...principal, actorId }, issued, now), null,
      "untrusted or impossible Identity actor identifier must not enter Operator permissions");
  }
  const ownerDate = "Wed, 18 Nov 2026 12:30:00 GMT";
  assert.equal(parseIssuedOperatorToken({ ...issued, sessionExpiresAt: ownerDate }, now), null,
    "Identity contract requires RFC3339 date-time, not Date.parse guesses");
  assert.equal(parseVerifiedOperatorPrincipal({ ...principal, sessionExpiresAt: ownerDate },
    { ...issued, sessionExpiresAt: ownerDate }, now), null);
  assert.deepEqual(parseIssuedOperatorToken(issued, now), issued);
  assert.deepEqual(parseVerifiedOperatorPrincipal(principal, issued, now), principal);
  assert.deepEqual(parseVerifiedOperatorPrincipal({ ...principal, actorId: "مشغّل" }, issued, now),
    { ...principal, actorId: "مشغّل" },
    "valid UTF-8 Identity actor IDs must remain supported");
});

test("stalled Identity response fails closed and cancels its stream before returning", { timeout: 7500 }, async () => {
  const { boundedResponseJSON } = await import("../src/server/operator-passkey-transport.ts");
  let cancelled = false;
  let controller;
  const response = new Response(new ReadableStream({
    start(value) { controller = value; value.enqueue(new TextEncoder().encode('{"actorId":')); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  let timer;
  try {
    const result = await Promise.race([
      boundedResponseJSON(response).then(() => "accepted", () => "rejected"),
      new Promise(resolve => { timer = setTimeout(() => resolve("unbounded"), 5800); }),
    ]);
    assert.equal(result, "rejected");
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
  } finally {
    clearTimeout(timer);
    if (!cancelled) controller.close();
  }
});

test("oversized owner response cancels the remaining stream and releases its reader", async () => {
  const { boundedResponseJSON } = await import("../src/server/operator-passkey-transport.ts");
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(() => boundedResponseJSON(response));
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test("body admission rejects invalid length, empty data, malformed UTF-8 and broken streams", async () => {
  const { boundedResponseJSON, boundedRequestBody, isEmptyRequestBody } =
    await import("../src/server/operator-passkey-transport.ts");
  const url = "http://localhost:13000/api/auth/passkey/authentication";
  const request = (body, headers = {}) => new Request(url, { method: "POST", body, headers, duplex: "half" });
  for (const length of ["bogus", "65537"]) {
    assert.equal(await boundedRequestBody(request("{}", { "content-length": length })), null);
    await assert.rejects(() => boundedResponseJSON(new Response("{}", { headers: { "content-length": length } })));
  }
  assert.equal(await boundedRequestBody(request(null)), null);
  assert.equal(await boundedRequestBody(request("")), null);
  assert.equal(await boundedRequestBody(request("12345"), 4), null);
  assert.equal(await boundedRequestBody(request(new Uint8Array([0xff]))), null);
  assert.equal(await isEmptyRequestBody(request(null, { "transfer-encoding": "chunked" })), false);
  assert.equal(await isEmptyRequestBody(request(null, { "content-length": "0" })), true);
  await assert.rejects(() => boundedResponseJSON(new Response(null)));
  await assert.rejects(() => boundedResponseJSON(new Response("not JSON")));
  await assert.rejects(() => boundedResponseJSON(new Response(new Uint8Array([0xff]))));
  const locked = request("{}");
  const reader = locked.body.getReader();
  try { assert.equal(await boundedRequestBody(locked), null); }
  finally { reader.releaseLock(); }
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("source failed")); } }));
  await assert.rejects(() => boundedResponseJSON(broken));
  assert.equal(broken.body.locked, false);
  const valid = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"value":'));
    controller.enqueue(new TextEncoder().encode('42}'));
    controller.close();
  }}), { headers: { "content-length": "12" } });
  assert.deepEqual(await boundedResponseJSON(valid), { value: 42 });
});

test("Identity transport permits only owner operations and preserves the finite request policy", async t => {
  const { operatorIdentityRequest } = await import("../src/server/operator-passkey-transport.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return Response.json({});
  });
  await assert.rejects(() => operatorIdentityRequest(config, { method: "GET", path: "/v1/unowned" }, {}));
  assert.equal(calls.length, 0);
  await operatorIdentityRequest(config, { method: "GET", path: "/v1/sessions/current" }, {
    cache: "force-cache", redirect: "follow", headers: { Authorization: "Bearer " + token },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config.identityOrigin + "/v1/sessions/current");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("a rejected body does not wait for a source whose cancellation rejects", async () => {
  const { boundedResponseJSON } = await import("../src/server/operator-passkey-transport.ts");
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { return Promise.reject(new Error("uncooperative source")); },
  }));
  await assert.rejects(() => boundedResponseJSON(response));
  assert.equal(response.body.locked, false);
});

test("all rejected body declarations cancel the source without consuming or retaining it", async () => {
  const { boundedResponseJSON, boundedRequestBody, isEmptyRequestBody } =
    await import("../src/server/operator-passkey-transport.ts");
  const url = "http://localhost:13000/api/auth/passkey/authentication";
  const cases = [
    { headers: { "content-length": "65537" }, call: body => boundedResponseJSON(new Response(body, { headers: { "content-length": "65537" } })).then(() => "accepted", () => "rejected"), expected: "rejected" },
    { headers: { "content-length": "broken" }, call: body => boundedRequestBody(new Request(url, { method: "POST", body, duplex: "half", headers: { "content-length": "broken" } })), expected: null },
    { headers: {}, call: body => boundedRequestBody(new Request(url, { method: "POST", body, duplex: "half" }), 65537), expected: null },
    { headers: { "content-length": "1" }, call: body => isEmptyRequestBody(new Request(url, { method: "POST", body, duplex: "half", headers: { "content-length": "1" } })), expected: false },
    { headers: { "transfer-encoding": "chunked" }, call: body => isEmptyRequestBody(new Request(url, { method: "POST", body, duplex: "half", headers: { "transfer-encoding": "chunked" } })), expected: false },
  ];
  for (const { call, expected, headers } of cases) {
    let cancels = 0;
    const body = new ReadableStream({
      cancel() { cancels++; return Promise.reject(new Error("source cancel rejected")); },
    });
    assert.equal(await call(body), expected, JSON.stringify(headers));
    assert.equal(cancels, 1, JSON.stringify(headers));
    assert.equal(body.locked, false);
  }
});

test("Operator permission outcome preserves authoritative session rejection across concurrent owner failures", async t => {
  const { readOperatorAccessState, readVerifiedOperatorAccess } = await import("../src/server/operator-passkey-bff.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
  let mode = "outage";
  let rejectedPermission = "operations";
  let failedPermission = "finance";
  let includesRejection = true;
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname;
    if (path === "/v1/sessions/current") {
      return Response.json({ actorId: "operator-one", role: "operator", sessionExpiresAt: expiry });
    }
    const permission = path.split("/").at(-1);
    if (permission === rejectedPermission && includesRejection) {
      return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    }
    if (permission === failedPermission) {
      if (mode === "network") throw new Error("Owner unavailable");
      if (mode === "outage") return Response.json({ code: "OWNER_UNAVAILABLE" }, { status: 503 });
      return Response.json({ actorId: "different-operator", permission });
    }
    return Response.json({ actorId: "operator-one", permission });
  });
  for (mode of ["outage", "network", "mismatch"]) {
    for (const [rejection, failure] of [["operations", "finance"], ["finance", "operations"]]) {
      rejectedPermission = rejection;
      failedPermission = failure;
      includesRejection = true;
      assert.deepEqual(await readOperatorAccessState(config, token), { status: "signed-out" }, mode + " with " + rejection);
      assert.equal(await readVerifiedOperatorAccess(config, token), null);
      includesRejection = false;
      assert.deepEqual(await readOperatorAccessState(config, token), { status: "unavailable" }, mode + " without rejection");
      assert.equal(await readVerifiedOperatorAccess(config, token), null);
    }
  }
});

test("Operator grant outcome rejects malformed principals and expiry during permission reads", async t => {
  const { readOperatorAccessState } = await import("../src/server/operator-passkey-bff.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  assert.ok(config);
  const start = Date.now();
  const expiry = new Date(start + 60_000).toISOString();
  let mode = "network";
  let reads = 0;
  let current = start;
  t.mock.method(Date, "now", () => current);
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname;
    if (path === "/v1/sessions/current") {
      if (mode === "network") throw new Error("Owner unavailable");
      if (mode === "missing-expiry") return Response.json({ actorId: "operator-one", role: "operator" });
      return Response.json({
        actorId: "operator-one", role: mode === "unknown-role" ? "unknown" : "operator", sessionExpiresAt: expiry,
      });
    }
    reads++;
    current = start + 60_000;
    return Response.json({ actorId: "operator-one", permission: path.split("/").at(-1) });
  });
  for (mode of ["network", "missing-expiry", "unknown-role"]) {
    assert.deepEqual(await readOperatorAccessState(config, token), { status: "unavailable" }, mode);
    assert.equal(reads, 0);
  }
  mode = "expires-during-read";
  assert.deepEqual(await readOperatorAccessState(config, token), { status: "signed-out" });
  assert.equal(reads, 7);
});

test("Operator owner transport releases all non-admitted response streams without changing their status", async t => {
  const { operatorIdentityRequest, operatorPermissionOperation, boundedResponseJSON } =
    await import("../src/server/operator-passkey-transport.ts");
  const { identityOperations } = await import("../../../services/identity/clients/index.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  const operations = [
    [identityOperations.beginOperatorPasskeyAuthentication, 200],
    [identityOperations.finishOperatorPasskeyAuthentication, 200],
    [identityOperations.beginInitialOperatorPasskeyRegistration, 200],
    [identityOperations.finishInitialOperatorPasskeyRegistration, 201],
    [identityOperations.beginExistingOperatorPasskeyRecovery, 200],
    [identityOperations.finishExistingOperatorPasskeyRecovery, 200],
    [identityOperations.getVerifiedIdentitySession, 200],
    [identityOperations.revokeCurrentIdentitySession, 204],
    [operatorPermissionOperation("operations"), 200],
  ];
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [operation, accepted] of operations) {
    for (const status of [401, 403, 503, accepted === 201 ? 200 : 201]) {
      let cancelled = 0;
      const body = new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } });
      response = new Response(body, { status });
      const reply = await operatorIdentityRequest(config, operation, {});
      assert.equal(reply.status, status);
      assert.equal(cancelled, 1, operation.path + " " + status);
      assert.equal(body.locked, false);
    }
    if (accepted === 204) {
      response = new Response(null, { status: accepted });
      assert.equal((await operatorIdentityRequest(config, operation, {})).status, 204);
    } else {
      response = Response.json({ admitted: true }, { status: accepted });
      const reply = await operatorIdentityRequest(config, operation, {});
      assert.deepEqual(await boundedResponseJSON(reply), { admitted: true });
    }
  }
});

test("Operator owner rejection closes a real HTTP stream and permits subsequent recovery", { timeout: 6000 }, async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { operatorIdentityRequest, boundedResponseJSON } = await import("../src/server/operator-passkey-transport.ts");
  let requests = 0;
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    if (++requests === 1) {
      response.on("close", closed);
      response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      response.write('{"code":"UNAUTHORIZED"');
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end('{"recovered":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let timer;
  try {
    const config = { ...resolveIsolatedOperatorConfig(goodEnv), identityOrigin: "http://127.0.0.1:" + server.address().port };
    const operation = { method: "GET", path: "/v1/sessions/current" };
    assert.equal((await operatorIdentityRequest(config, operation, {})).status, 401);
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); });
    assert.notEqual(await Promise.race([disconnected, deadline]), false, "rejected socket remained open");
    const recovered = await operatorIdentityRequest(config, operation, {});
    assert.equal(recovered.status, 200);
    assert.deepEqual(await boundedResponseJSON(recovered), { recovered: true });
    assert.equal(requests, 2);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("Operator response cleanup errors preserve authoritative rejection", async t => {
  const { operatorIdentityRequest } = await import("../src/server/operator-passkey-transport.ts");
  const config = resolveIsolatedOperatorConfig(goodEnv);
  const operation = { method: "GET", path: "/v1/sessions/current" };
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const body of [
    null,
    { locked: true, cancel() { assert.fail("locked body is not owned"); } },
    { locked: false, cancel() { throw new Error("native cancellation failed"); } },
    { locked: false, cancel() { return Promise.reject(new Error("cancellation rejected")); } },
  ]) {
    response = { status: 401, body };
    assert.equal((await operatorIdentityRequest(config, operation, {})).status, 401);
  }
  response = { status: 503, get body() { throw new Error("native getter failed"); } };
  assert.equal((await operatorIdentityRequest(config, operation, {})).status, 503);
});
