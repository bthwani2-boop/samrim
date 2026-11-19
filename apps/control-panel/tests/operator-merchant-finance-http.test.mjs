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
const token = Buffer.alloc(32, 19).toString("base64url");
const cases = [
  ["partner-store-commissions", "merchant-store-commissions"],
  ["partner-commission-receivables", "merchant-commission-receivables"],
];

async function unusedPort() {
  const socket = createSocket();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("merchant finance routes keep protected real-HTTP backward compatibility", {
  timeout: 60000,
  skip: process.env.BTHWANI_OPERATOR_HTTP_TEST === "1" ? false : "Requires production Next build",
}, async () => {
  assert.ok(existsSync(path.join(panel, ".next", "BUILD_ID")), "Run Next build before HTTP testing");
  const permissions = new Set(["finance"]);
  let identityAvailable = true;
  const ownerCalls = [];
  const expiry = new Date(Date.now() + 10 * 60_000).toISOString();
  const owner = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://localhost").pathname;
    ownerCalls.push(route);
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    if (!identityAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (request.headers.authorization !== "Bearer " + token) {
      return send(401, { error: "UNAUTHORIZED" });
    }
    if (route === "/v1/sessions/current") {
      return send(200, {
        actorId: "operator-finance-rename", role: "operator", sessionExpiresAt: expiry,
      });
    }
    const prefix = "/v1/operators/me/permissions/";
    if (route.startsWith(prefix)) {
      const permission = route.slice(prefix.length);
      return permissions.has(permission)
        ? send(200, { actorId: "operator-finance-rename", permission })
        : send(403, { error: "FORBIDDEN" });
    }
    return send(404, { error: "NOT_FOUND" });
  });
  await new Promise((resolve, reject) => {
    owner.once("error", reject);
    owner.listen(0, "127.0.0.1", resolve);
  });
  const ownerPort = owner.address().port;
  const port = await unusedPort();
  const base = "http://localhost:" + port;
  const child = spawn(process.execPath, [cli, "start", "-H", "localhost", "-p", String(port)], {
    cwd: panel, windowsHide: true,
    env: {
      ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
      BTHWANI_ISOLATED_TEST_MODE: "true",
      OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
      OPERATOR_PASSKEY_BROWSER_ORIGIN: base,
      OPERATOR_PASSKEY_IDENTITY_ORIGIN: "http://127.0.0.1:" + ownerPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-2500); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-2500); });

  const request = async (route) => {
    return fetch(base + route, {
      headers: { cookie: "bthwani_operator_session=" + token },
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(7000),
    });
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Next exited early: " + output);
      try {
        const res = await fetch(base + "/health", { signal: AbortSignal.timeout(1300) });
        await res.arrayBuffer();
        if (res.status === 200) { ready = true; break; }
      } catch { /* Wait for synthetic isolated server. */ }
      await delay(250);
    }
    assert.ok(ready, "Next did not start: " + output);
    for (const [legacy, canonical] of cases) {
      const canonicalResponse = await request("/finance/" + canonical);
      const canonicalHtml = await canonicalResponse.text();
      assert.equal(canonicalResponse.status, 200, canonicalHtml.slice(0, 400));
      assert.match(canonicalResponse.headers.get("cache-control") ?? "", /no-store/);

      const oldResponse = await request("/finance/" + legacy);
      assert.equal(oldResponse.status, 307, "old " + legacy + " redirects");
      assert.equal(oldResponse.headers.get("location"), "/finance/" + canonical);
      await oldResponse.arrayBuffer();

      permissions.clear();
      permissions.add("merchant");
      const deniedLegacy = await request("/finance/" + legacy);
      const deniedHtml = await deniedLegacy.text();
      assert.equal(deniedLegacy.status, 200, "workspace gate owns denied responses");
      assert.equal(deniedLegacy.headers.get("location"), null);
      assert.ok(!deniedHtml.includes('href="/finance/' + canonical + '"'));
      assert.doesNotMatch(deniedHtml, /data-owner-readback="ready"/);
      assert.match(deniedHtml, /id="workspace-denied-title"/);
      const deniedCanonical = await request("/finance/" + canonical);
      assert.equal(deniedCanonical.status, 200);
      assert.match(await deniedCanonical.text(), /id="workspace-denied-title"/);
      permissions.clear();
      permissions.add("finance");
    }
    identityAvailable = false;
    const outage = await request("/finance/partner-store-commissions");
    assert.equal(outage.status, 200);
    assert.equal(outage.headers.get("location"), null);
    assert.match(await outage.text(), /id="workspace-denied-title"/);
    assert.ok(ownerCalls.includes("/v1/operators/me/permissions/finance"));
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) {
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
    }
    await new Promise((resolve) => owner.close(resolve));
  }
});
