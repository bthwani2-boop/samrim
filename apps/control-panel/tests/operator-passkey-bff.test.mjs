import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cookieLifetimeSeconds,
  isTrustedOperatorRequest,
  OPERATOR_COOKIE,
  parseIssuedOperatorToken,
  parsePasskeyOptions,
  parseVerifiedOperatorPrincipal,
  resolveIsolatedOperatorConfig,
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
