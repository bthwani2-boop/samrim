import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(panel, "node_modules", "next", "dist", "bin", "next");
const token = Buffer.alloc(32, 9).toString("base64url");
const city = "sanaa";

async function unusedPort() {
  const socket = createSocket();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("Operator city policy flows through real Next BFF, Identity grant and DSH versioned owner", {
  timeout: 70000,
  skip: process.env.BTHWANI_OPERATOR_HTTP_TEST === "1" ? false : "Run after production Next build",
}, async () => {
  assert.ok(existsSync(path.join(panel, ".next", "BUILD_ID")), "Build Operator host before HTTP test");
  const expiry = new Date(Date.now() + 15 * 60000).toISOString();
  const allowed = new Set(["platform_policies"]);
  let identityAvailable = true;
  let dshAvailable = true;
  let badDshReadback = false;
  let loseNextPatchReply = false;
  const ownerCalls = [];
  const dshCalls = [];
  let effectivePolicy = {
    cityId: city, version: 1, maxPauseSeconds: 3600, maxPreparationMinutes: 30,
    changedByActor: "operator-original", changeReason: "Initial synthetic owner baseline",
    updatedAt: new Date().toISOString(),
  };
  const audit = new Map();
  const owner = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    ownerCalls.push(route);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (!identityAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (request.headers.authorization !== `Bearer ${token}`) {
      return send(401, { error: "UNAUTHORIZED" });
    }
    if (route === "/v1/sessions/current") {
      return send(200, { actorId: "operator-original", role: "operator", sessionExpiresAt: expiry });
    }
    if (route.startsWith("/v1/operators/me/permissions/")) {
      const permission = route.split("/").at(-1);
      return allowed.has(permission)
        ? send(200, { actorId: "operator-original", permission })
        : send(403, { error: "FORBIDDEN" });
    }
    return send(404, { error: "NOT_FOUND" });
  });
  const dsh = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    dshCalls.push({ route, method: request.method });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (!dshAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (request.headers.authorization !== `Bearer ${token}` ||
        !allowed.has("platform_policies")) return send(403, { error: "FORBIDDEN" });
    if (route !== `/v1/operators/cities/${city}/store-availability-policy`) {
      return send(400, { error: "INVALID_REQUEST" });
    }
    if (request.method === "GET") return send(200,
      badDshReadback ? { ...effectivePolicy, cityId: "different-city" } : effectivePolicy);
    if (request.method !== "PATCH") return send(405, { error: "METHOD_NOT_ALLOWED" });
    void (async () => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const change = JSON.parse(body);
      assert.deepEqual(Object.keys(change).sort(),
        ["expectedVersion", "maxPauseSeconds", "maxPreparationMinutes", "operationId", "reason"].sort());
      const previous = audit.get(change.operationId);
      if (previous) {
        if (JSON.stringify(previous.change) !== JSON.stringify(change)) {
          return send(409, { error: "IDEMPOTENCY_KEY_REUSED" });
        }
        return send(200, { policy: previous.policy, replay: true });
      }
      if (change.expectedVersion !== effectivePolicy.version) {
        return send(409, { error: "OPERATIONAL_POLICY_VERSION_CONFLICT" });
      }
      effectivePolicy = {
        ...effectivePolicy, version: effectivePolicy.version + 1,
        maxPauseSeconds: change.maxPauseSeconds,
        maxPreparationMinutes: change.maxPreparationMinutes,
        changedByActor: "operator-original",
        changeReason: change.reason,
        updatedAt: new Date().toISOString(),
      };
      audit.set(change.operationId, { change, policy: effectivePolicy });
      if (loseNextPatchReply) {
        loseNextPatchReply = false;
        return send(503, { error: "OPERATION_RESULT_UNKNOWN" });
      }
      return send(200, { policy: effectivePolicy, replay: false });
    })().catch(() => send(400, { error: "INVALID_REQUEST" }));
  });
  const ownerPort = await listen(owner);
  const dshPort = await listen(dsh);
  const port = await unusedPort();
  const base = `http://localhost:${port}`;
  const api = `${base}/api/policies/cities/${city}`;
  const cookie = `bthwani_operator_session=${token}`;
  const child = spawn(process.execPath, [cli, "start", "-H", "localhost", "-p", String(port)], {
    cwd: panel, windowsHide: true,
    env: {
      ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      BTHWANI_ISOLATED_TEST_MODE: "true",
      OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
      OPERATOR_PASSKEY_BROWSER_ORIGIN: base,
      OPERATOR_PASSKEY_IDENTITY_ORIGIN: `http://127.0.0.1:${ownerPort}`,
      OPERATOR_POLICY_DSH_ORIGIN: `http://127.0.0.1:${dshPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-2400); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-2400); });

  async function call(url, init = {}) {
    return fetch(url, {
      ...init, headers: { cookie, ...(init.headers ?? {}) },
      cache: "no-store", signal: AbortSignal.timeout(7000),
    });
  }
  async function patch(body, headers = { origin: base, "content-type": "application/json" }) {
    return call(api, { method: "PATCH", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  }

  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`Next exited: ${output}`);
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1400) });
        if (response.status === 200) { ready = true; break; }
      } catch { /* Production process warming. */ }
      await delay(250);
    }
    assert.ok(ready, `Isolated production Next failed: ${output}`);

    const home = await call(`${base}/policies`);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /حدود إتاحة المتاجر لكل مدينة/, "real Operator policy editor must replace the placeholder");
    assert.doesNotMatch(html, /البيانات والإجراءات غير مفعّلة/);
    assert.match(html, /href="\/policies"/);

    let res = await call(api);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await res.json()).version, 1);
    assert.equal(dshCalls.length, 1);

    allowed.clear();
    res = await call(api);
    assert.equal(res.status, 403, "a valid Operator role without current grant cannot read policy");
    assert.equal(dshCalls.length, 1, "no upstream DSH call if Identity denies scope");
    res = await patch({ operationId: "grantless-01" });
    assert.equal(res.status, 403);
    assert.equal(dshCalls.length, 1);
    allowed.add("platform_policies");

    res = await call(`${base}/api/policies/cities/INVALID`);
    assert.equal(res.status, 400);
    res = await patch({ invalid: "payload" });
    assert.equal(res.status, 400);
    res = await patch({ operationId: "valid-op-001", expectedVersion: 1,
      maxPauseSeconds: 1000, maxPreparationMinutes: 20, reason: "Reviewed synthetic limit" },
    { origin: "http://attacker.invalid", "content-type": "application/json" });
    assert.equal(res.status, 400, "cross-origin mutation must be rejected");
    res = await patch({ operationId: "valid-op-001", expectedVersion: 1,
      maxPauseSeconds: 1000, maxPreparationMinutes: 20, reason: "Reviewed synthetic limit" },
    { origin: base, "content-type": "application/json", "x-actor-id": "other-operator" });
    assert.equal(res.status, 400, "actor spoofing must be rejected");
    assert.equal(dshCalls.length, 1, "invalid BFF mutations cannot reach DSH");

    const change = {
      operationId: "city-policy-001", expectedVersion: 1,
      maxPauseSeconds: 900, maxPreparationMinutes: 25,
      reason: "Synthetic operational review of city limits",
    };
    res = await patch(change);
    assert.equal(res.status, 200, `expected owner mutation: ${output}`);
    let result = await res.json();
    assert.equal(result.policy.version, 2);
    assert.equal(result.policy.maxPauseSeconds, 900);
    assert.equal(result.replay, false);
    assert.equal(audit.size, 1, "one immutable owner command recorded");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(token), "never echo browser session bearer");

    res = await call(api);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).version, 2, "independent DSH readback sees committed change");

    res = await patch(change);
    assert.equal(res.status, 200);
    result = await res.json();
    assert.equal(result.replay, true);
    assert.equal(result.policy.version, 2);
    assert.equal(audit.size, 1, "idempotent replay must not append history");

    res = await patch({ ...change, maxPauseSeconds: 901 });
    assert.equal(res.status, 409, "reusing a key for different data is forbidden");
    res = await patch({ ...change, operationId: "city-policy-002" });
    assert.equal(res.status, 409, "stale version cannot overwrite current owner version");

    loseNextPatchReply = true;
    const uncertain = {
      ...change, expectedVersion: 2, operationId: "city-policy-003",
      maxPauseSeconds: 600,
    };
    res = await patch(uncertain);
    assert.equal(res.status, 503, "committed-but-unknown outcome must not be claimed as success");
    assert.equal(effectivePolicy.version, 3, "synthetic owner wrote despite lost confirmation");
    res = await patch(uncertain);
    assert.equal(res.status, 200, "same operation is safe to reconcile");
    result = await res.json();
    assert.equal(result.replay, true);
    assert.equal(result.policy.version, 3);
    assert.equal(audit.size, 2, "unknown-reply replay must not duplicate owner write");

    badDshReadback = true;
    res = await call(api);
    assert.equal(res.status, 503, "inconsistent owner city must fail closed");
    badDshReadback = false;

    dshAvailable = false;
    res = await call(api);
    assert.equal(res.status, 503);
    res = await patch({ ...change, operationId: "city-policy-004", expectedVersion: 3 });
    assert.equal(res.status, 503, "owner outage must not be returned as a successful mutation");
    dshAvailable = true;

    identityAvailable = false;
    const dshBefore = dshCalls.length;
    res = await call(api);
    assert.equal(res.status, 401, "unverified Identity session must not read policy");
    assert.equal(dshCalls.length, dshBefore);
    identityAvailable = true;

    assert.equal(effectivePolicy.version, 3);
    assert.equal(audit.size, 2);
    assert.ok(ownerCalls.includes("/v1/operators/me/permissions/platform_policies"));
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(3000)]);
    }
    await new Promise(resolve => owner.close(resolve));
    await new Promise(resolve => dsh.close(resolve));
  }
});
