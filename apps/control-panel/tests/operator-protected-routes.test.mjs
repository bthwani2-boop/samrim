import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { workspaceRegistry } from "../src/features/navigation/workspace-registry.ts";

const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(panel, "node_modules", "next", "dist", "bin", "next");

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("Operator routes and the browser session endpoint fail closed on the production host", {
  timeout: 60000,
  skip: process.env.BTHWANI_OPERATOR_HTTP_TEST === "1" ? false : "Run after the production Next build",
}, async () => {
  assert.ok(existsSync(path.join(panel, ".next", "BUILD_ID")), "run the Next build before HTTP testing");
  assert.ok(existsSync(cli), "frozen local Next dependency is missing");
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [cli, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: panel,
    windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-2000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-2000); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Next process exited: ${output}`);
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) { ready = true; await response.arrayBuffer(); break; }
      } catch { /* local host has not started yet */ }
      await delay(250);
    }
    assert.ok(ready, `isolated Operator host did not start: ${output}`);
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(health.status, 200);
    assert.match(await health.text(), /href="\/"[^>]*>فتح لوحة تحكم بثواني<\/a>/);
    const entry = await fetch(`${base}/`, { signal: AbortSignal.timeout(10000) });
    assert.equal(entry.status, 200);
    const entryHtml = await entry.text();
    assert.match(entryHtml, /تسجيل دخول المشغّلين غير متاح على هذه النسخة/);
    assert.doesNotMatch(entryHtml, /تسجيل الدخول بمفتاح المرور/);
    const lockedSections = entryHtml.match(/<section\b[^>]*aria-label="الأقسام الرئيسية \(تتطلب تسجيل الدخول\)"[^>]*>(.*?)<\/section>/s)?.[1];
    assert.ok(lockedSections, "guest must see a read-only section map in the sidebar");
    assert.match(lockedSections, /العمليات/);
    assert.match(lockedSections, /المالية/);
    assert.doesNotMatch(lockedSections, /<(?:a|button)\\b/, "no disabled section may become a protected action");
    assert.doesNotMatch(entryHtml, /aria-label="تبويبات الأقسام"/, "tabs require verified grants");
    const overview = entryHtml.match(/<section\b[^>]*aria-labelledby="operator-sections-title"[^>]*>(.*?)<\/section>/s)?.[1];
    assert.ok(overview, "the guest landing must show the public section overview");
    assert.match(overview, /تظهر روابط الأقسام بعد التحقق من صلاحيات حسابك/);
    assert.doesNotMatch(overview, /<(?:a|button)\b/);
    assert.deepEqual(
      Array.from(overview.matchAll(/<li>([^<]+)<\/li>/g), item => item[1]),
      workspaceRegistry.filter(item => item.permission !== null).map(item => item.label),
    );
    for (const { href } of workspaceRegistry) {
      assert.ok(!entryHtml.includes(`href="${href}"`), `guest entry exposed ${href}`);
    }
    for (const route of ["/operations", "/operations/store-availability?storeId=market-sanaa", "/merchants/stores/synthetic", "/merchants/public-stores?city=sanaa", "/merchants/public-stores/market-sanaa?city=sanaa", "/finance", "/finance/merchant-store-commissions", "/finance/merchant-commission-receivables", "/finance/partner-store-commissions", "/finance/partner-commission-receivables", "/access", "/policies/stage-sla"]) {
      const response = await fetch(base + route, {
        headers: { "x-operator-role": "operator", "x-actor-id": "forged-actor", Cookie: "operator=forged" },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/, route);
      const html = await response.text();
      assert.match(html, /الوصول إلى هذه المساحة غير متاح/, route);
      assert.match(html, /href="\/"[^>]*>فتح صفحة دخول المشغّل<\/a>/, route);
      assert.match(html, /aria-label="التنقل الرئيسي"/, route);
      assert.match(html, /href="\/health"/, route);
      assert.doesNotMatch(html, /href="\/(?:workspace|operations|catalog|finance|access|policies)"/, route);
      assert.doesNotMatch(html, /data-owner-readback="ready"/, route);
    }
    for (const method of ["GET", "POST"]) {
      const response = await fetch(`${base}/api/auth/session`, {
        method,
        headers: { "x-operator-role": "operator", Authorization: "Bearer forged" },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 503, method);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/, method);
      assert.equal((await response.json()).code, "OPERATOR_SESSION_UNAVAILABLE");
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) {
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
    }
  }
});
