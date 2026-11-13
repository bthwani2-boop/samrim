import assert from "node:assert/strict";
import test from "node:test";
import { containsLikelySecret, forbiddenName } from "./verify-secrets.mjs";

test("rejects actual credential filenames, but allows non-secret examples", () => {
  for (const name of ["apps/customer/google-services.json", ".env", "services/dsh/secret.p12",
    "apps/customer/credentials.json", "apps/customer/cert.pem"]) {
    assert.equal(forbiddenName(name), true, name);
  }
  assert.equal(forbiddenName("apps/customer/.env.example"), false);
  assert.equal(forbiddenName("services/dsh/clients/index.ts"), false);
});
test("flags private-key and provider-token patterns without printing their content", () => {
  assert.equal(containsLikelySecret("-----BEGIN " + "OPENSSH PRIVATE " + "KEY-----"), true);
  assert.equal(containsLikelySecret('{"private_' + 'key":"some secret"}'), true);
  assert.equal(containsLikelySecret("ghp_" + "a".repeat(30)), true);
  assert.equal(containsLikelySecret("github_pat_" + "a".repeat(30)), true);
  assert.equal(containsLikelySecret("sk_live_" + "a".repeat(20)), true);
});
test("ordinary source and example labels are not credentials", () => {
  assert.equal(containsLikelySecret("const color = '#112233';"), false);
  assert.equal(containsLikelySecret("C:/BTHWANI-Secrets/env/mobile.env"), false);
});
