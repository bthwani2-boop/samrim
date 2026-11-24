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
  let refreshCalls = 0;
  const refreshToken = Buffer.alloc(32, 8).toString("base64url");
  const nextRefreshToken = Buffer.alloc(32, 9).toString("base64url");
  let dshAvailable = true;
  const publicReads = [];
  const calls = [];
  const owner = createServer((request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    calls.push(route);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    if (!ownerAvailable) return send(503, { error: "OWNER_UNAVAILABLE" });
    if (request.method === "GET" && route.startsWith("/v1/public/")) {
      publicReads.push(route);
      if (!dshAvailable) return send(503, { error: "DSH_UNAVAILABLE" });
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (route === "/v1/public/cities") {
        return send(200, { items: ["sanaa"], revision: 3 });
      }
      if (requestUrl.searchParams.get("city_id") !== "sanaa") {
        return send(400, { error: "INVALID_CITY" });
      }
      if (route === "/v1/public/stores") {
        return send(200, { items: [{
          id: "market-sanaa", name: "متجر الاختبار المنشور", cityId: "sanaa",
          verticalId: "grocery", orderabilityStatus: "OPEN_FOR_ORDERS", orderingAvailable: false,
        }], revision: 3 });
      }
      if (route === "/v1/public/verticals") {
        return send(200, { items: [{ id: "grocery", storeCount: 1 }], revision: 3 });
      }
      return send(404, { error: "NOT_FOUND" });
    }
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
    if (route === "/v1/sessions/refresh" && request.method === "POST") {
      refreshCalls++;
      if (request.headers.authorization !== `Bearer ${refreshToken}`) {
        return send(401, { code: "UNAUTHORIZED" });
      }
      return send(200, { accessToken: token, sessionExpiresAt: expiry,
        refreshToken: nextRefreshToken, refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() });
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
      OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF: "true",
      OPERATOR_PASSKEY_BROWSER_ORIGIN: base,
      OPERATOR_PASSKEY_IDENTITY_ORIGIN: `http://127.0.0.1:${ownerPort}`,
      OPERATOR_POLICY_DSH_ORIGIN: `http://127.0.0.1:${ownerPort}`,
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

    const guestEntry = await fetch(`${base}/`, { signal: AbortSignal.timeout(7000) });
    assert.equal(guestEntry.status, 200);
    const guestHtml = await guestEntry.text();
    assert.match(guestHtml, /تسجيل الدخول بمفتاح المرور/);
    assert.doesNotMatch(guestHtml, /operator-sections-title|aria-label="التنقل الرئيسي"/,
      "the standalone sign-in page must not expose workspace navigation");
    assert.doesNotMatch(guestHtml, /id="operator-bootstrap-proof"/,
      "a bootstrap opt-in cannot permit enrollment at an unapproved origin");
    const retained = { cookie: `bthwani_operator_refresh=${refreshToken}` };
    const recoveryEntry = await fetch(`${base}/`, { headers: retained, signal: AbortSignal.timeout(7000) });
    assert.equal(recoveryEntry.status, 200);
    const recoveryHtml = await recoveryEntry.text();
    assert.match(recoveryHtml, /id="operator-session-restore"/);
    assert.doesNotMatch(recoveryHtml, /id="operator-passkey-sign-in"|aria-label="التنقل الرئيسي"/);
    assert.equal(refreshCalls, 0, "document rendering must not rotate a credential");
    ownerAvailable = false;
    const unavailableRecovery = await fetch(`${base}/api/auth/session`, { headers: retained });
    assert.equal(unavailableRecovery.status, 503);
    assert.equal(unavailableRecovery.headers.get("set-cookie"), null);
    ownerAvailable = true;
    const recoveredSession = await fetch(`${base}/api/auth/session`, { headers: retained });
    assert.equal(recoveredSession.status, 200);
    assert.equal(refreshCalls, 1);
    const recoveredBody = await recoveredSession.json();
    assert.equal(recoveredBody.role, "operator");
    assert.equal(recoveredBody.actorId, "operator-synthetic");
    assert.doesNotMatch(JSON.stringify(recoveredBody), new RegExp(nextRefreshToken));
    const recoveredCookies = recoveredSession.headers.getSetCookie();
    assert.ok(recoveredCookies.some(value => value.startsWith(`bthwani_operator_refresh=${nextRefreshToken};`) && /httponly/i.test(value)));
    assert.ok(recoveredCookies.some(value => value.startsWith(`bthwani_operator_session=${token};`) && /httponly/i.test(value)));
    const rejectedRecovery = await fetch(`${base}/api/auth/session`, {
      headers: { cookie: `bthwani_operator_refresh=${Buffer.alloc(32, 10).toString("base64url")}` },
    });
    assert.equal(rejectedRecovery.status, 401);
    assert.match(rejectedRecovery.headers.get("set-cookie") ?? "", /bthwani_operator_refresh=;/);
    const guestWorkspace = await fetch(`${base}/workspace?city=sanaa`, { signal: AbortSignal.timeout(7000) });
    const guestWorkspaceHtml = await guestWorkspace.text();
    assert.equal(guestWorkspace.status, 200);
    assert.match(guestWorkspaceHtml, /الوصول إلى هذه المساحة غير متاح/);
    assert.doesNotMatch(guestWorkspaceHtml, /متجر الاختبار المنشور|لمحة السوق المنشور/);
    assert.equal(publicReads.length, 0, "unauthenticated page cannot read DSH");

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

    const signedInRoot = await fetch(`${base}/`, {
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
    assert.equal((html.match(/<nav\b[^>]*aria-label="التنقل الرئيسي"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /aria-label="تبويبات الأقسام"/);
    assert.ok(html.includes('href="/workspace"'));
    assert.doesNotMatch(html, /aria-label="تبويبات الوظائف"/);
    assert.ok(calls.includes("/v1/operators/me/permissions/operations"));
    html = await read("/workspace");
    assert.match(html, /مرحبًا بك في لوحة تحكم بثواني/);
    assert.match(html, /إدارة العمل من مساحة واحدة، وفق صلاحياتك المؤكدة من Identity/);
    assert.match(html, /العمليات/);
    assert.match(html, /href="\/operations"/);
    assert.match(html, /href="\/captains"/);
    assert.doesNotMatch(html, /href="\/(?:finance|access|policies)"/);

    const noMarket = await read("/workspace?city=sanaa");
    assert.doesNotMatch(noMarket, /لمحة السوق المنشور/);
    assert.equal(publicReads.length, 0, "operations grant must not trigger market reads");

    allowed.add("merchant");
    const merchantHtml = await read("/merchants");
    assert.match(merchantHtml, /aria-label="تبويبات الوظائف"/);
    assert.ok(merchantHtml.includes('href="/merchants/public-stores"'));
    assert.ok(!merchantHtml.includes('href="/finance"'));
    const marketHtml = await read("/workspace?city=sanaa");
    assert.match(marketHtml, /لمحة السوق المنشور/);
    assert.match(marketHtml, /متجر الاختبار المنشور/);
    assert.match(marketHtml, /عدد النتائج/);
    assert.ok(marketHtml.includes('href="/merchants/public-stores?city=sanaa"'));
    assert.match(marketHtml, /الأعداد المعروضة تخص الصفحة المحدودة/);
    assert.ok(publicReads.includes("/v1/public/stores"));
    assert.ok(publicReads.includes("/v1/public/verticals"));

    const successfulMarketReads = publicReads.length;
    const invalidMarket = await read("/workspace?city=..%2Faccess");
    assert.match(invalidMarket, /معاملات المدينة غير صالحة/);
    assert.equal(publicReads.length, successfulMarketReads, "invalid city must not reach DSH");

    dshAvailable = false;
    const unavailableMarket = await read("/workspace?city=sanaa");
    assert.match(unavailableMarket, /تعذّر تأكيد المتاجر المنشورة من DSH/);
    assert.doesNotMatch(unavailableMarket, /متجر الاختبار المنشور/);
    dshAvailable = true;

    allowed.delete("merchant");
    allowed.add("catalog");
    const catalogOnlyMarket = await read("/workspace?city=sanaa");
    assert.ok(catalogOnlyMarket.includes('href="/catalog/categories?city=sanaa"'));
    assert.ok(!catalogOnlyMarket.includes('href="/merchants/public-stores?city=sanaa"'));
    allowed.delete("catalog");

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
    assert.match(html, /تعذّر التحقق من الجلسة والصلاحيات لدى Identity/);
    assert.doesNotMatch(html, /href="\/(?:workspace|operations|captains)"/);
    html = await read("/");
    assert.match(html, /تعذّر التحقق من الجلسة والصلاحيات لدى Identity/);
    ownerAvailable = true;
    assert.match(await read("/operations"), /href="\/captains"/, "owner recovery restores current grants");

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
