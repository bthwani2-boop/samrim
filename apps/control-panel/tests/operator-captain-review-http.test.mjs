import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const panel = path.resolve(import.meta.dirname, "..");
const nextCli = path.join(panel, "node_modules", "next", "dist", "bin", "next");
const token = Buffer.alloc(32, 7).toString("base64url");
const captain = "captain-synthetic";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function freePort() {
  const socket = createSocket();
  const port = await listen(socket);
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test("real Operator Next Captain review BFF enforces live scope, origin and owner versioned write", {
  timeout: 70000,
  skip: process.env.BTHWANI_OPERATOR_HTTP_TEST !== "1" && "Run after production Next build",
}, async () => {
  assert.ok(existsSync(path.join(panel, ".next", "BUILD_ID")), "Build control-panel before HTTP test");
  const expiry = new Date(Date.now() + 15 * 60000).toISOString();
  let allowed = true;
  let identityAvailable = true;
  let unknownReply = false;
  let corruptOwner = false;
  let standing = { actorId: captain, status: "PENDING", version: 1 };
  const history = new Map();
  const ownerCalls = [];
  const dshCalls = [];
  const identity = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    ownerCalls.push(url.pathname);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (!identityAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "UNAUTHORIZED" });
    if (url.pathname === "/v1/sessions/current") {
      return send(200, { actorId: "operator-synthetic", role: "operator", sessionExpiresAt: expiry });
    }
    if (url.pathname.startsWith("/v1/operators/me/permissions/")) {
      const permission = url.pathname.split("/").at(-1);
      return allowed && permission === "operations"
        ? send(200, { actorId: "operator-synthetic", permission })
        : send(403, { error: "FORBIDDEN" });
    }
    return send(404, { error: "NOT_FOUND" });
  });
  const dsh = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    dshCalls.push({ method: request.method, route: url.pathname });
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (request.headers.authorization !== `Bearer ${token}` || !allowed) {
      return send(403, { error: "FORBIDDEN" });
    }
    if (url.pathname !== `/v1/operators/captains/${captain}/standing`) {
      return send(404, { error: "NOT_FOUND" });
    }
    if (request.method === "GET") {
      return send(200, corruptOwner ? { ...standing, privateReason: "secret" } : standing);
    }
    if (request.method !== "PATCH") return send(405, { error: "METHOD_NOT_ALLOWED" });
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += chunk.toString("utf8");
      const change = JSON.parse(raw);
      assert.deepEqual(Object.keys(change).sort(),
        ["status", "expectedVersion", "operationId", "reason"].sort());
      const replay = history.get(change.operationId);
      if (replay) {
        return JSON.stringify(replay.change) === JSON.stringify(change)
          ? send(200, replay.standing)
          : send(409, { error: "IDEMPOTENCY_KEY_REUSED" });
      }
      if (change.expectedVersion !== standing.version) {
        return send(409, { error: "CAPTAIN_STANDING_VERSION_CONFLICT" });
      }
      standing = { actorId: captain, status: change.status, version: standing.version + 1 };
      history.set(change.operationId, { change, standing: { ...standing } });
      if (unknownReply) {
        unknownReply = false;
        return send(503, { error: "OPERATION_RESULT_UNKNOWN" });
      }
      return send(200, standing);
    })().catch(() => send(400, { error: "INVALID_REQUEST" }));
  });
  const identityPort = await listen(identity);
  const dshPort = await listen(dsh);
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const api = `${base}/api/captains/${captain}/standing`;
  const cookie = `bthwani_operator_session=${token}`;
  const app = spawn(process.execPath, [nextCli, "start", "-H", "localhost", "-p", String(port)], {
    cwd: panel, windowsHide: true,
    env: {
      ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      BTHWANI_ISOLATED_TEST_MODE: "true",
      OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
      OPERATOR_PASSKEY_BROWSER_ORIGIN: base,
      OPERATOR_PASSKEY_IDENTITY_ORIGIN: `http://127.0.0.1:${identityPort}`,
      OPERATOR_POLICY_DSH_ORIGIN: `http://127.0.0.1:${dshPort}`,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", chunk => { output = (output + chunk).slice(-2000); });
  app.stderr.on("data", chunk => { output = (output + chunk).slice(-2000); });
  const call = (url, init = {}) => fetch(url, {
    ...init, headers: { cookie, ...(init.headers ?? {}) }, cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  const patch = (payload, headers = {}) => call(api, {
    method: "PATCH",
    headers: { origin: base, "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (app.exitCode !== null) throw new Error(`Next exited: ${output}`);
      try {
        const reply = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1200) });
        if (reply.status === 200) { ready = true; break; }
      } catch { /* app starting */ }
      await delay(250);
    }
    assert.ok(ready, `Next did not start: ${output}`);
    let response = await call(api);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await response.json(), standing);
    assert.equal(dshCalls.length, 1);

    allowed = false;
    response = await call(api);
    assert.equal(response.status, 403, "current operations grant required");
    response = await patch({ invalid: true });
    assert.equal(response.status, 403);
    assert.equal(dshCalls.length, 1, "no owner call when current grant revoked");
    allowed = true;

    const valid = {
      status: "APPROVED", expectedVersion: 1,
      operationId: "captain-review-001", reason: "Synthetic document review",
    };
    response = await patch(valid, { origin: "http://attacker.invalid" });
    assert.equal(response.status, 403);
    response = await patch({ ...valid, privateActor: "forged" });
    assert.equal(response.status, 400);
    response = await patch({ ...valid, reason: "x".repeat(2500) });
    assert.equal(response.status, 400);
    response = await patch(valid, { "x-actor-id": "operator-forged" });
    assert.equal(response.status, 403);
    assert.equal(dshCalls.length, 1, "rejected mutation never reaches DSH");

    response = await patch(valid);
    assert.equal(response.status, 200, `owner approval must succeed: ${output}`);
    assert.deepEqual(await response.json(), { actorId: captain, status: "APPROVED", version: 2 });
    assert.equal(history.size, 1);
    response = await call(api);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, 2, "independent readback of synthetic DSH state");

    response = await patch(valid);
    assert.equal(response.status, 200, "stable replay is idempotent");
    assert.equal(history.size, 1);
    response = await patch({ ...valid, operationId: "captain-review-002" });
    assert.equal(response.status, 409, "stale version cannot overwrite standing");

    corruptOwner = true;
    response = await call(api);
    assert.equal(response.status, 503, "reject unexpected private owner fields");
    corruptOwner = false;

    unknownReply = true;
    response = await patch({ status: "SUSPENDED", expectedVersion: 2,
      operationId: "captain-review-003", reason: "Synthetic safety hold" });
    assert.equal(response.status, 503, "unknown committed outcome must not be reported success");
    assert.equal(standing.status, "SUSPENDED");
    assert.equal(history.size, 2);

    identityAvailable = false;
    const count = dshCalls.length;
    response = await call(api);
    assert.equal(response.status, 401);
    assert.equal(dshCalls.length, count);
    assert.ok(ownerCalls.includes("/v1/operators/me/permissions/operations"));
  } finally {
    if (app.exitCode === null) app.kill("SIGTERM");
    if (app.exitCode === null) {
      await Promise.race([new Promise(resolve => app.once("exit", resolve)), delay(3000)]);
    }
    await new Promise(resolve => identity.close(resolve));
    await new Promise(resolve => dsh.close(resolve));
  }
});
