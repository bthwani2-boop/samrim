#!/usr/bin/env node
// Operator Stage-4 HTTP/SSR smoke against the existing production Next build.
// No provider credentials, external network, user records, or application services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = path.join(root, "apps", "control-panel");
const nextCli = path.join(app, "node_modules", "next", "dist", "bin", "next");
assert.ok(existsSync(nextCli), "Install the existing frozen workspace dependencies first");
assert.ok(existsSync(path.join(app, ".next", "BUILD_ID")),
  "Run pnpm --dir apps/control-panel build before the production HTTP smoke");

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => socket.close(resolve));
  return address.port;
}

function nonceFromEnforcedCsp(response, route) {
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy, `${route} has no enforced CSP header`);
  assert.equal(response.headers.get("content-security-policy-report-only"), null,
    `${route} CSP is only in report mode`);
  for (const directive of [
    "default-src 'self'", "style-src 'self' 'unsafe-inline'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'",
    "frame-ancestors 'none'", "connect-src 'self'",
  ]) {
    assert.ok(policy.includes(directive), `${route} lost CSP directive: ${directive}`);
  }
  const scriptDirective = policy.match(/(?:^|;\s*)script-src\s+([^;]+)/)?.[1] ?? "";
  assert.ok(scriptDirective.includes("'strict-dynamic'"), `${route} lost strict script chaining`);
  assert.ok(!scriptDirective.includes("'unsafe-inline'") && !scriptDirective.includes("'unsafe-eval'"),
    `${route} permits inline or evaluated production scripts`);
  const nonce = scriptDirective.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(nonce && nonce.length >= 20, `${route} missing unpredictable script nonce`);
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /(?:^|,\s*)no-store(?:\s*,|$)/,
    `${route} must not cache a per-request script nonce`);
  return nonce;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [nextCli, "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: app,
  env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let error;
let output = "";
server.on("error", (cause) => { error = cause; });
server.stdout.on("data", (data) => { output = (output + data).slice(-3000); });
server.stderr.on("data", (data) => { output = (output + data).slice(-3000); });

try {
  const expires = Date.now() + 30000;
  let ready = false;
  while (Date.now() < expires) {
    if (error || server.exitCode !== null) {
      throw new Error(`Operator host exited before readiness: ${error?.message ?? output}`);
    }
    try {
      const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(2500) });
      if (response.status === 200) {
        ready = true;
        await response.arrayBuffer();
        break;
      }
    } catch {
      // The loopback listener may not have started yet.
    }
    await delay(250);
  }
  assert.ok(ready, `Operator host readiness timed out: ${output}`);

  const routes = [
    ["/", 200, "بثواني — لوحة المشغّل"],
    ["/health", 200, "الملاحة في لوحة التحكم تعمل"],
    ["/lab", 200, "مختبر مكونات Ant Design"],
    ["/nonexistent-stage4-operator-smoke", 404, null],
  ];
  const seenNonces = new Set();
  for (const [route, expectedStatus, visibleText] of routes) {
    const response = await fetch(base + route, {
      signal: AbortSignal.timeout(7000),
      redirect: "manual",
    });
    assert.equal(response.status, expectedStatus, `${route} returned wrong status`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/i, `${route} is not HTML`);
    assert.equal(response.headers.get("x-frame-options"), "DENY", `${route} lost clickjacking protection`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${route} lost MIME sniff protection`);
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(response.headers.get("permissions-policy"),
      "camera=(), microphone=(), geolocation=(), payment=()");
    assert.equal(response.headers.get("x-powered-by"), null, `${route} discloses the framework`);
    const nonce = nonceFromEnforcedCsp(response, route);
    assert.ok(!seenNonces.has(nonce), `${route} repeated a previously used response nonce`);
    seenNonces.add(nonce);
    const html = await response.text();
    if (visibleText) {
      assert.match(html, /<html\b[^>]*\blang="ar"[^>]*\bdir="rtl"/i, `${route} lost document RTL`);
      assert.match(html, /<meta\b[^>]*\bname="robots"[^>]*\bcontent="[^"]*noindex/i,
        `${route} lost noindex on the nonfunctional foundation`);
      assert.ok(html.includes(visibleText), `${route} did not render expected content in SSR`);
      assert.ok(html.includes(`nonce="${nonce}"`), `${route} Next.js SSR scripts lost their CSP nonce`);
    }
  }
  const retry = await fetch(`${base}/`, { signal: AbortSignal.timeout(7000) });
  assert.equal(retry.status, 200);
  const retryNonce = nonceFromEnforcedCsp(retry, "/ repeated");
  assert.ok(!seenNonces.has(retryNonce), "nonce was reused for a second document request");
  await retry.arrayBuffer();
  const forged = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(7000),
    headers: {
      "x-nonce": "attacker-controlled",
      "Content-Security-Policy": "script-src 'unsafe-inline'",
    },
  });
  assert.equal(forged.status, 200);
  const forgedNonce = nonceFromEnforcedCsp(forged, "/health forged request");
  assert.notEqual(forgedNonce, "attacker-controlled", "client-supplied nonce was accepted");
  assert.ok(!seenNonces.has(forgedNonce) && forgedNonce !== retryNonce,
    "a forged request reused an earlier nonce");
  const forgedHtml = await forged.text();
  assert.ok(forgedHtml.includes(`nonce="${forgedNonce}"`),
    "the response nonce differs from the trusted server-rendered scripts");
  console.log("OPERATOR_PRODUCTION_HTTP_SMOKE_PASS routes=4 nonce_unique=6 forged_header_rejected=true script_csp=enforced style_inline_exception=true browser_hydration=NOT_RUN");
} finally {
  if (server.exitCode === null && !server.killed) {
    server.kill("SIGTERM");
  }
  if (server.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(3000),
    ]);
  }
}
