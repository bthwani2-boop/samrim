import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validOperatorStoreRegistrationChange as validateDSHPolicyChange } from "../../../services/dsh/clients/operator-store-registration-policy.ts";

const file = fileURLToPath(new URL("../app/api/policies/cities/[cityid]/store-registration/[relation]/route.ts", import.meta.url));
const source = readFileSync(file, "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["\x27]([^"\x27]+)["\x27];/gs,
    (_match, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/export const (runtime|dynamic) =/g, "const $1 =")
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = { GET, PATCH };";
const browser = "http://localhost:13000";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const url = `${browser}/api/policies/cities/sanaa/store-registration/MARKETPLACE`;
const policy = { cityId: "sanaa", relation: "MARKETPLACE", version: 1, enabled: true,
  termsVersion: "terms-v1", termsText: "Verified terms", changedByActor: "operator-a",
  changeReason: "Policy granted", updatedAt: new Date().toISOString() };
const command = { operationId: "register-policy-001", expectedVersion: 0, enabled: true,
  termsVersion: "terms-v1", termsText: "Verified terms", reason: "Policy granted" };

class OwnerError extends Error {
  constructor(status, code = "OWNER_UNAVAILABLE") {
    super(code);
    this.status = status;
    this.code = code;
  }
}
function harness(t) {
  const previous = process.env.OPERATOR_POLICY_DSH_ORIGIN;
  process.env.OPERATOR_POLICY_DSH_ORIGIN = "http://127.0.0.1:33222";
  t.after(() => {
    if (previous === undefined) delete process.env.OPERATOR_POLICY_DSH_ORIGIN;
    else process.env.OPERATOR_POLICY_DSH_ORIGIN = previous;
  });
  const state = { access: { actorId: "operator-a", grants: ["platform_policies"] },
    enabled: true, cookie: bearer, dshCalls: [], dshError: null, dshResultActor: "operator-a" };
  const owner = {
    DshPublicError: OwnerError,
    async getOperatorStoreRegistrationPolicy(...args) {
      state.dshCalls.push(["GET", ...args]);
      if (state.dshError) throw state.dshError;
      return policy;
    },
    async changeOperatorStoreRegistrationPolicy(...args) {
      state.dshCalls.push(["PATCH", ...args]);
      if (state.dshError) throw state.dshError;
      const change = args[4];
      return { policy: { ...policy, termsVersion: change.termsVersion, termsText: change.termsText,
        changeReason: change.reason, changedByActor: state.dshResultActor }, replay: false };
    },
    validOperatorStoreRegistrationChange: validateDSHPolicyChange,
    async listOperatorStoreRegistrationPolicyHistory(...args) {
      state.dshCalls.push(["HISTORY", ...args]);
      if (state.dshError) throw state.dshError;
      return { entries: [{
        version: 2, enabled: false, termsVersion: "merchant-terms-v1",
        changedByActor: "operator-a", changeReason: "Synthetic closure",
        updatedAt: "2026-11-23T00:00:00Z",
      }] };
    },
  };
  const mocks = {
    "@bthwani/dsh": owner,
    "next/headers": { cookies: async () => ({ get(name) {
      assert.equal(name, "bthwani_operator_session");
      return state.cookie ? { value: state.cookie } : undefined;
    } }) },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "../../../../../../../src/server/current-operator-access": {
      currentOperatorAccess: async () => state.access,
    },
    "../../../../../../../src/server/operator-passkey-bff": {
      OPERATOR_COOKIE: "bthwani_operator_session",
      boundedRequestBody: async (request, maxBytes) => {
        state.maxCommandBytes = maxBytes;
        const body = await request.text();
        return Buffer.byteLength(body, "utf8") <= maxBytes ? body : null;
      },
      resolveIsolatedOperatorConfig: () => state.enabled ? { browserOrigin: browser } : null,
    },
    "../../../../../../../src/server/request-security": {
      unavailableSessionResponse: () => Response.json({ code: "OPERATOR_SESSION_UNAVAILABLE" }, { status: 503 }),
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    key => {
      assert.ok(Object.hasOwn(mocks, key), `unexpected BFF import ${key}`);
      return mocks[key];
    },
    module, module.exports, process,
  );
  function request(method = "GET", headers = {}, body) {
    return new Request(url, {
      method,
      headers: { Host: "localhost:13000", "X-BThwani-Operator": "operator-a",
        ...(method === "PATCH" ? { Origin: browser, "Content-Type": "application/json" } : {}),
        ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const context = { params: Promise.resolve({ cityid: "sanaa", relation: "MARKETPLACE" }) };
  return { state, request, context, GET: module.exports.GET, PATCH: module.exports.PATCH };
}

test("Operator BFF reads and writes only after current verified platform_policies access", async t => {
  const h = harness(t);
  const response = await h.GET(h.request(), h.context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.deepEqual(await response.json(), policy);
  const write = await h.PATCH(h.request("PATCH", {}, command), h.context);
  assert.equal(write.status, 200);
  assert.deepEqual(await write.json(), { policy, replay: false });
  assert.equal(h.state.dshCalls.length, 2);
  assert.equal(h.state.dshCalls[1][4], bearer);
  assert.deepEqual(h.state.dshCalls[1][5], command);
});
test("Operator BFF rejects missing grant, session, and spoofed operator context before DSH", async t => {
  const h = harness(t);
  h.state.access.grants = [];
  assert.equal((await h.GET(h.request(), h.context)).status, 403);
  h.state.access = null;
  assert.equal((await h.GET(h.request(), h.context)).status, 401);
  h.state.access = { actorId: "operator-a", grants: ["platform_policies"] };
  h.state.cookie = null;
  assert.equal((await h.GET(h.request(), h.context)).status, 401);
  h.state.cookie = bearer;
  assert.equal((await h.GET(h.request("GET", { "X-BThwani-Operator": "other" }), h.context)).status, 403);
  assert.equal(h.state.dshCalls.length, 0);
});
test("Operator BFF blocks cross-origin, invalid relation and injected authority", async t => {
  const h = harness(t);
  for (const headers of [
    { Origin: "https://evil.invalid" }, { Authorization: "Bearer forged" },
    { "X-Actor-ID": "operator-other" }, { "Sec-Fetch-Site": "cross-site" },
    { "X-Forwarded-Host": "evil.invalid" },
  ]) assert.equal((await h.PATCH(h.request("PATCH", headers, command), h.context)).status, 400);
  const invalid = { params: Promise.resolve({ cityid: "sanaa", relation: "PARTNER" }) };
  assert.equal((await h.GET(h.request(), invalid)).status, 400);
  assert.equal(h.state.dshCalls.length, 0);
});
test("Operator BFF rejects malformed policy and lost result, without a false success", async t => {
  const h = harness(t);
  assert.equal((await h.PATCH(h.request("PATCH", {}, { policy: "owner-admin" }), h.context)).status, 400);
  assert.equal(h.state.dshCalls.length, 0);
  h.state.dshError = new OwnerError(503, "OPERATION_RESULT_UNKNOWN");
  assert.equal((await h.PATCH(h.request("PATCH", {}, command), h.context)).status, 503);
  h.state.dshError = null;
  h.state.dshResultActor = "other-operator";
  assert.equal((await h.PATCH(h.request("PATCH", {}, command), h.context)).status, 503);
  assert.equal(h.state.dshCalls.length, 2);
});
test("Operator BFF preserves conflict status and disables itself without isolated owner config", async t => {
  const h = harness(t);
  h.state.dshError = new OwnerError(409, "OPERATIONAL_POLICY_VERSION_CONFLICT");
  assert.equal((await h.PATCH(h.request("PATCH", {}, command), h.context)).status, 409);
  h.state.enabled = false;
  assert.equal((await h.GET(h.request(), h.context)).status, 503);
});

test("Operator policy BFF accepts the full 4,000-codepoint Unicode terms contract without truncation", async t => {
  const h = harness(t);
  const extensive = { ...command, termsText: "😀".repeat(4000) };
  assert.ok(Buffer.byteLength(JSON.stringify(extensive), "utf8") > 8192,
    "regression requires a valid request larger than the old 8 KiB limit");
  const reply = await h.PATCH(h.request("PATCH", {}, extensive), h.context);
  assert.equal(reply.status, 200);
  assert.equal(h.state.maxCommandBytes, 24576);
  assert.equal(h.state.dshCalls.length, 1);
  assert.equal(h.state.dshCalls[0][5].termsText, extensive.termsText);
});

test("Operator BFF read-only history enforces the same current Identity rights", async t => {
  const h = harness(t);
  const query = "?history=1&limit=10&beforeVersion=3";
  const historyRequest = () => new Request(h.request().url + query, {
    method: "GET",
    headers: { Host: "localhost:13000", "X-BThwani-Operator": "operator-a" },
  });
  const reply = await h.GET(historyRequest(), h.context);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal((await reply.json()).entries[0].version, 2);
  assert.equal(h.state.dshCalls.length, 1);
  assert.equal(h.state.dshCalls[0][0], "HISTORY");
  assert.equal(h.state.dshCalls[0][4], bearer);
  assert.equal(h.state.dshCalls[0][5], 10);
  assert.equal(h.state.dshCalls[0][6], "3");
  h.state.access.grants = [];
  assert.equal((await h.GET(historyRequest(), h.context)).status, 403);
  h.state.access = null;
  assert.equal((await h.GET(historyRequest(), h.context)).status, 401);
  assert.equal(h.state.dshCalls.length, 1);
});

test("Operator BFF history rejects unauthorized query selectors and does not fabricate status", async t => {
  const h = harness(t);
  const build = search => new Request(h.request().url + search, {
    headers: { Host: "localhost:13000", "X-BThwani-Operator": "operator-a" },
  });
  for (const query of [
    "?admin=1", "?history=1&limit=0", "?history=1&limit=51",
    "?history=1&beforeVersion=0", "?history=1&beforeVersion=0002",
    "?history=1&limit=10&actorId=other", "?history=1&limit=2&limit=3",
    "?history=1&limit=20&beforeVersion=%2F",
  ]) assert.equal((await h.GET(build(query), h.context)).status, 400, query);
  assert.equal(h.state.dshCalls.length, 0);
  h.state.dshError = new OwnerError(503);
  assert.equal((await h.GET(build("?history=1&limit=10"), h.context)).status, 503);
});
