import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyMerchantAdmission } from "../src/features/access/admission.ts";

const origin = "https://identity.bthwani.test";
const customerBearer = Buffer.alloc(32, 1).toString("base64url");
const merchantBearer = Buffer.alloc(32, 2).toString("base64url");

function verifyAgainstOwner(t, readMerchantSession, onRevoke = () => {}) {
  const revoked = [];
  const sessionExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const merchant = { actorId: "actor-one", role: "merchant", sessionExpiresAt };
  const json = (value, status = 200) => Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  t.mock.method(globalThis, "fetch", async (url, request) => {
    const path = new URL(url).pathname;
    const bearer = request.headers.Authorization?.slice("Bearer ".length);
    switch (`${request.method} ${path}`) {
      case "POST /v1/customer-auth/phone-verification":
        return json({ accessToken: customerBearer, sessionExpiresAt });
      case "GET /v1/sessions/current":
        if (bearer === customerBearer) return json({ ...merchant, role: "customer" });
        assert.equal(bearer, merchantBearer);
        return readMerchantSession(json, merchant);
      case "POST /v1/actors/me/merchant-role":
        assert.equal(bearer, customerBearer);
        return json({ accessToken: merchantBearer, sessionExpiresAt }, 201);
      case "DELETE /v1/sessions/current":
        assert.equal(request.signal.aborted, false);
        revoked.push(bearer);
        onRevoke(bearer);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      default:
        assert.fail(`Unexpected owner call ${request.method} ${path}`);
    }
  });
  const signal = new AbortController();
  return { merchant, revoked, signal, verify: () =>
    verifyMerchantAdmission(origin, Buffer.alloc(32, 3).toString("base64url"), "123456", signal.signal) };
}

test("Merchant admission retains only the verified session for the same actor", async t => {
  const { merchant, revoked, verify } = verifyAgainstOwner(t, (json, session) => json(session));
  assert.deepEqual(await verify(), { bearer: merchantBearer, session: merchant });
  assert.deepEqual(revoked, [customerBearer]);
});

test("Merchant admission revokes an issued bearer when its owner read selects another actor", async t => {
  const { revoked, verify } = verifyAgainstOwner(t, (json, session) =>
    json({ ...session, actorId: "actor-two" }));
  await assert.rejects(verify, { code: "OWNER_RESPONSE_INVALID" });
  assert.deepEqual(revoked.sort(), [customerBearer, merchantBearer].sort());
});

test("Merchant admission cleans up after the caller cancels the owner read", async t => {
  const { revoked, signal, verify } = verifyAgainstOwner(t, (json, session) => {
    signal.abort();
    return json(session);
  });
  await assert.rejects(verify, { code: "OWNER_RESPONSE_STALE" });
  assert.deepEqual(revoked.sort(), [customerBearer, merchantBearer].sort());
});

test("Merchant admission revokes its session if cancellation occurs during Customer cleanup", async t => {
  const { revoked, signal, verify } = verifyAgainstOwner(t, (json, session) => json(session), bearer => {
    if (bearer === customerBearer) signal.abort();
  });
  await assert.rejects(verify, { code: "OPERATION_RESULT_UNKNOWN" });
  assert.deepEqual(revoked, [customerBearer, merchantBearer]);
});
