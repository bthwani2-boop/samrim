import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrustedOperatorRequest, resolveOperatorRecoveryConfig } from "../src/server/operator-passkey-config.ts";
import { validInitialOperatorPayload } from "../src/server/operator-passkey-validation.ts";

const env = {
  BTHWANI_ISOLATED_TEST_MODE: "true",
  OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
  OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://localhost:13000",
  OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:3201",
};

test("recovery stays disabled without independent explicit opt-in", () => {
  assert.equal(resolveOperatorRecoveryConfig(env), null);
  assert.equal(resolveOperatorRecoveryConfig({
    ...env, OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF: "false",
  }), null);
  assert.equal(resolveOperatorRecoveryConfig({
    ...env, BTHWANI_ISOLATED_TEST_MODE: "false",
    OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF: "true",
  }), null);
  assert.equal(resolveOperatorRecoveryConfig({
    ...env, OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "false",
    OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF: "true",
  }), null);
  assert.equal(resolveOperatorRecoveryConfig({
    ...env, OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF: "true",
    OPERATOR_PASSKEY_BROWSER_ORIGIN: "http://127.0.0.1:13000",
  }), null);
});

test("recovery uses one exact trusted localhost origin, never an actor-selected body", () => {
  const config = resolveOperatorRecoveryConfig({
    ...env, OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF: "true",
  });
  assert.deepEqual(config, {
    browserOrigin: "http://localhost:13000", identityOrigin: "http://127.0.0.1:3201",
  });
  const proof = "A".repeat(43);
  const ceremonyId = "B".repeat(43);
  assert.equal(validInitialOperatorPayload({ proof }, false), true);
  assert.equal(validInitialOperatorPayload({ proof, actorId: "root" }, false), false);
  assert.equal(validInitialOperatorPayload({ proof, permission: "platform_policies" }, false), false);
  assert.equal(validInitialOperatorPayload({ proof, ceremonyId }, false), false);
  assert.equal(validInitialOperatorPayload({ proof, ceremonyId, credential: {
    type: "public-key", id: "id", rawId: "rawid", response: {},
  } }, true), true);
  assert.equal(validInitialOperatorPayload({ proof, ceremonyId, credential: { type: "public-key" }, role: "operator" }, true), false);
  const url = "http://localhost:13000/api/auth/passkey/recovery/options";
  const req = headers => new Request(url, { method: "POST", headers });
  assert.equal(isTrustedOperatorRequest(req({ host: "localhost:13000", origin: "http://localhost:13000" }), config), true);
  assert.equal(isTrustedOperatorRequest(req({ host: "localhost:13000", origin: "http://evil.test" }), config), false);
  assert.equal(isTrustedOperatorRequest(req({ host: "localhost:13000", origin: "http://localhost:13000", authorization: "Bearer forged" }), config), false);
});
