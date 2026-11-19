import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundedRequestBody,
  cookieLifetimeSeconds,
  isEmptyRequestBody,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  parseIssuedOperatorToken,
  parsePasskeyOptions,
  parseVerifiedOperatorPrincipal,
  resolveIsolatedOperatorConfig,
  validAssertion,
} from "../src/server/operator-passkey-bff.ts";

const goodEnv = {
  BTHWANI_ISOLATED_TEST_MODE: "true",
  OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
  OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:13000",
  OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:18110",
};
const now = Date.parse("2026-11-18T12:00:00Z");
const token = "A".repeat(43);

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
    if (permission === "operations" || permission === "partners") {
      return Response.json({ actorId: "operator-one", permission });
    }
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  });
  assert.deepEqual(await readVerifiedOperatorAccess(config, token), {
    actorId: "operator-one", grants: ["operations", "partners"],
  });
  assert.equal(queried.length, 8, "session and all seven finite permissions must be read");
});

test("Operator workspace owner mismatch, role spoof, revoked session and outage all fail closed", async t => {
  const { readVerifiedOperatorAccess } = await import("../src/server/operator-passkey-bff.ts");
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
    return Response.json({ actorId: mode === "different-actor" ? "operator-two" : "operator-one", permission });
  });
  for (mode of ["different-actor", "role-spoof", "revoked", "outage"]) {
    assert.equal(await readVerifiedOperatorAccess(config, token), null, mode);
  }
  const before = calls;
  assert.equal(await readVerifiedOperatorAccess(config, "forged"), null);
  assert.equal(calls, before, "malformed cookie cannot trigger Identity calls");
});
