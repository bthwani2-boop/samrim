import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { challengeSourceHash, challengeSourceHeaders } from "./challenge-source.mjs";

const phone = "+967712345678";

test("challenge source headers deterministically map valid actors into the benchmark address range", () => {
  const first = challengeSourceHeaders(phone);
  const second = challengeSourceHeaders(phone);

  assert.deepEqual(Object.keys(first), ["X-Forwarded-For"]);
  assert.equal(first["X-Forwarded-For"], second["X-Forwarded-For"]);
  const octets = first["X-Forwarded-For"].split(".").map(Number);
  assert.equal(octets.length, 4);
  assert.equal(octets[0], 198);
  assert.ok(octets[1] === 18 || octets[1] === 19);
  assert.ok(octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255));
});

test("challenge source hashes use the canonical client-ip HMAC input", () => {
  const sourceIP = challengeSourceHeaders(phone)["X-Forwarded-For"];
  const secret = "identity-proof-secret";
  const expected = crypto.createHmac("sha256", secret).update("client-ip\0").update(sourceIP).digest("hex");

  assert.equal(challengeSourceHash(phone, secret), expected);
});

test("challenge source helpers reject phone values outside normalized E.164", () => {
  for (const invalidPhone of ["", "967712345678", "+067712345678", "+96771234567x", "+9677123456789012"]) {
    assert.throws(() => challengeSourceHeaders(invalidPhone), TypeError);
    assert.throws(() => challengeSourceHash(invalidPhone, "secret"), TypeError);
  }
});
