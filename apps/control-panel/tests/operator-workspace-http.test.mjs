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
const token = Buffer.alloc(32, 7).toString("base64url");

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

test("production Operator UI rechecks isolated Identity grants on every document request", {
  timeout: 60000,
  skip: process.env.BTHWANI_OPERATOR_HTTP_TEST === "1" ? false : "Run after production Next build",
}, async () => {
  assert.ok(existsSync(path.join(panel, ".next", "BUILD_ID")), "Build Operator host before HTTP test");
  const allowed = new Set(["operations"]);
  const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
  let role = "operator";
  let ownerAvailable = true;
  let actorMismatch = false;
  let revoked = false;
  let revokeCalls = 0;
  let optionsCalls = 0;
  let authenticationCalls = 0;
  const calls = [];
  const owner = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    calls.push(route);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    if (!ownerAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (route === "/v1/operators/passkey/authentication/options" && request.method === "POST") {
      optionsCalls++;
      return send(200, {
        ceremonyId: "B".repeat(43),
        options: { publicKey: { challenge: "C".repeat(43), rpId: "localhost", userVerification: "required" } },
      });
    }
    if (route === "/v1/operators/passkey/authentication" && request.method === "POST") {
      authenticationCalls++;
      void (async () => {
        let raw = "";
        for await (const chunk of request) raw += chunk.toString();
        const supplied = JSON.parse(raw);
        if (supplied.ceremonyId !== "B".repeat(43) || supplied.credential?.type !== "public-key") {
          return send(401, { error: "UNAUTHORIZED" });
        }
        return send(200, { accessToken: token, sessionExpiresAt: expiry });
      })().catch(() => send(400, { error: "INVALID_REQUEST" }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      return send(401, { error: "UNAUTHORIZED" });
    }
    if (route === "/v1/sessions/current") {
      if (request.method === "DELETE") {
        revokeCalls++;
        revoked = true;
        response.writeHead(204);
        return response.end();
      }
      if (revoked) return send(401, { error: "UNAUTHORIZED" });
      return send(200, { actorId: "operator-synthetic", role, sessionExpiresAt: expiry });
    }
    const prefix = "/v1/operators/me/permissions/";
    if (route.startsWith(prefix)) {
      const permission = route.slice(prefix.length);
      return allowed.has(permission)
        ? send(200, { actorId: actorMismatch ? "other-actor" : "operator-synthetic", permission })
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
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [cli, "start", "-H", "localhost", "-p", String(port)], {
    cwd: panel, windowsHide: true,
    env: {
      ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
      BTHWANI_ISOLATED_TEST_MODE: "true",
      OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF: "true",
      OPERATOR_PASSKEY_BROWSER_ORIGIN: base,
      OPERATOR_PASSKEY_IDENTITY_ORIGIN: `http://127.0.0.1:${ownerPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-2000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-2000); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Next exited: ${output}`);
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
        await response.arrayBuffer();
        if (response.status === 200) { ready = true; break; }
      } catch { /* Waiting for isolated Next. */ }
      await delay(250);
    }
    assert.ok(ready, `Isolated Next never started: ${output}`);

    // This is a real empty browser-style POST: Next materializes its body as a
    // readable stream even when no bytes were sent. It must reach Identity.
    const passkeyOptions = await fetch(`${base}/api/auth/passkey/options`, {
      method: "POST", headers: { origin: base }, signal: AbortSignal.timeout(7000),
    });
    assert.equal(passkeyOptions.status, 200, "empty Passkey options POST must not be rejected as a body");
    const beginOptions = await passkeyOptions.json();
    assert.equal(beginOptions.options.publicKey.rpId, "localhost");
    assert.equal(optionsCalls, 1, "exactly one Identity ceremony should be requested");
    for (const mutation of [
      { headers: { origin: "http://attacker.invalid" } },
      { headers: { origin: base }, body: "forged" },
    ]) {
      const denied = await fetch(`${base}/api/auth/passkey/options`, {
        method: "POST", ...mutation, signal: AbortSignal.timeout(7000),
      });
      assert.equal(denied.status, 400, "forged or non-empty options POST must be rejected");
    }
    assert.equal(optionsCalls, 1, "invalid browser requests must not begin extra ceremonies");

    // Only the synthetic Identity test owner accepts this non-hardware proof.
    // Exercise the real Next BFF flow, not WebAuthn authenticator security.
    const assertion = {
      ceremonyId: "B".repeat(43),
      credential: { type: "public-key", id: "synthetic-credential", rawId: "synthetic-credential", response: {} },
    };
    const forbiddenAssertion = await fetch(`${base}/api/auth/passkey/authentication`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ ...assertion, actorId: "other-operator" }),
      signal: AbortSignal.timeout(7000),
    });
    assert.equal(forbiddenAssertion.status, 400, "caller cannot choose the authenticated actor");
    assert.equal(authenticationCalls, 0, "forged proof must not contact Identity");
    const authentication = await fetch(`${base}/api/auth/passkey/authentication`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify(assertion),
      signal: AbortSignal.timeout(7000),
    });
    assert.equal(authentication.status, 200, "valid synthetic proof must complete BFF admission");
    assert.equal(authenticationCalls, 1);
    const cookie = authentication.headers.get("set-cookie") ?? "";
    assert.match(cookie, /bthwani_operator_session=/);
    assert.match(cookie, /httponly/i, "Identity bearer must remain server-managed");
    assert.match(cookie, /samesite=strict/i);
    const sessionReadback = await fetch(`${base}/api/auth/session`, {
      headers: { cookie: `bthwani_operator_session=${token}` }, signal: AbortSignal.timeout(7000),
    });
    assert.equal(sessionReadback.status, 200);
    const verifiedSession = await sessionReadback.json();
    assert.equal(verifiedSession.authenticated, true);
    assert.equal(verifiedSession.actorId, "operator-synthetic");
    assert.equal(verifiedSession.role, "operator");
    assert.doesNotMatch(JSON.stringify(verifiedSession), new RegExp(token));

    const signedInRoot = await fetch(base + "/", {
      headers: { cookie: `bthwani_operator_session=${token}` },
      redirect: "manual", signal: AbortSignal.timeout(7000),
    });
    assert.equal(signedInRoot.status, 307);
    assert.equal(signedInRoot.headers.get("location"), "/workspace");

    async function read(route, extra = {}) {
      const response = await fetch(base + route, {
        headers: { cookie: `bthwani_operator_session=${token}`, ...extra },
        cache: "no-store", signal: AbortSignal.timeout(7000),
      });
      const html = await response.text();
      assert.equal(response.status, 200, `${route}: ${output.slice(-1400)} ${html.slice(0, 350)}`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      return html;
    }
    let html = await read("/operations");
    assert.doesNotMatch(html, /الوصول إلى هذه المساحة غير متاح/);
    assert.match(html, /href="\/operations"/);
    assert.match(html, /تسجيل الخروج/, "authenticated workspace must offer a visible sign-out action");
    assert.doesNotMatch(html, /href="\/finance"/);
    assert.match(html, /aria-label="تبويبات الأقسام"/);
    assert.ok(html.includes('href="/workspace"'));
    assert.doesNotMatch(html, /aria-label="تبويبات الوظائف"/);
    assert.ok(calls.includes("/v1/operators/me/permissions/operations"));
    html = await read("/workspace");
    assert.match(html, /مساحة عمل المشغّل/);
    assert.match(html, /أقسام بانتظار ربط الخدمة/);
    assert.match(html, /href="\/operations"/);
    assert.match(html, /href="\/captains"/);
    assert.doesNotMatch(html, /href="\/(?:finance|access|policies)"/);

    allowed.add("partners");
    const merchantHtml = await read("/merchants");
    assert.match(merchantHtml, /aria-label="تبويبات الوظائف"/);
    assert.ok(merchantHtml.includes('href="/merchants/public-stores"'));
    assert.ok(!merchantHtml.includes('href="/finance"'));
    allowed.delete("partners");

    html = await read("/finance", { "x-bthwani-route": "/operations" });
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/);
    assert.doesNotMatch(html, /href="\/finance"/);

    allowed.delete("operations");
    html = await read("/operations");
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/, "grant revocation takes effect on next request");
    html = await read("/");
    assert.match(html, /تم التحقق من حسابك/);
    assert.match(html, /تسجيل الخروج/);
    assert.doesNotMatch(html, /href="\/(?:workspace|operations|captains)"/);
    allowed.add("operations");

    role = "merchant";
    html = await read("/operations");
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/, "wrong Identity role");
    role = "operator";

    actorMismatch = true;
    html = await read("/operations");
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/, "cross-actor grant spoof");
    actorMismatch = false;

    ownerAvailable = false;
    html = await read("/operations");
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/, "owner outage cannot grant permission");
    ownerAvailable = true;

    const rejected = await fetch(`${base}/api/auth/session`, {
      method: "POST",
      headers: { origin: "http://attacker.invalid", cookie: `bthwani_operator_session=${token}` },
    });
    assert.equal(rejected.status, 400, "cross-origin logout must not revoke a session");
    assert.equal(revokeCalls, 0);

    const withBody = await fetch(`${base}/api/auth/session`, {
      method: "POST",
      headers: { origin: base, cookie: `bthwani_operator_session=${token}` },
      body: "unexpected payload",
    });
    assert.equal(withBody.status, 400, "logout must reject a non-empty body");
    assert.equal(revokeCalls, 0);

    ownerAvailable = false;
    const unconfirmed = await fetch(`${base}/api/auth/session`, {
      method: "POST",
      headers: { origin: base, cookie: `bthwani_operator_session=${token}` },
    });
    assert.equal(unconfirmed.status, 503, "Identity outage must not be reported as a successful logout");
    assert.equal(revokeCalls, 0);
    ownerAvailable = true;

    const logout = await fetch(`${base}/api/auth/session`, {
      method: "POST",
      headers: { origin: base, cookie: `bthwani_operator_session=${token}` },
    });
    assert.equal(logout.status, 204, "browser logout must invoke Identity revocation");
    assert.match(logout.headers.get("set-cookie") ?? "", /bthwani_operator_session=;/);
    assert.equal(revokeCalls, 1, "logout must send a single DELETE to Identity");
    html = await read("/operations");
    assert.match(html, /الوصول إلى هذه المساحة غير متاح/, "revoked cookie cannot reopen workspace");
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(3000)]);
    }
    await new Promise(resolve => owner.close(resolve));
  }
});
