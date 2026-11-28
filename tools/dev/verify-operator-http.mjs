#!/usr/bin/env node
// Operator real-route CSP/SSR smoke. Default: production Next build; --dev: isolated Next development host.
// No provider credentials, external network, user records, or application services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertHtmlDocument, attr, bodyText, child, elements, htmlElement, mimeEssence, requestSsr, scriptKind } from "./ssr-document.mjs";


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

// Independent exact contract for the currently admitted Operator proxy policy.
// HTTP fields must be ASCII: Unicode trimming can admit a browser-ignored directive.
function asciiField(value, message) {
  assert.ok(value && !/[^\t\x20-\x7e]/u.test(value), message);
  return value;
}

export function assertOperatorPolicy(response, route, development) {
  const policy = asciiField(response.headers.get("content-security-policy"), route + ": expected ASCII CSP");
  assert.ok(!policy.includes(","), route + ": expected one enforced CSP");
  assert.equal(response.headers.get("content-security-policy-report-only"), null, route + ": unexpected report-only CSP");
  const directives = new Map();
  for (const entry of policy.split(";")) {
    const [rawName, ...values] = entry.split(/[\t ]+/u).filter(Boolean);
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    assert.ok(!directives.has(name), route + ": duplicate CSP directive " + name);
    directives.set(name, values);
  }
  const nonceTokens = (directives.get("script-src") ?? []).filter(value => value.startsWith("'nonce-"));
  assert.equal(nonceTokens.length, 1, route + ": expected exactly one script nonce");
  const nonce = /^'nonce-([A-Za-z0-9+/]+={0,2})'$/u.exec(nonceTokens[0])?.[1];
  assert.ok(nonce && Buffer.from(nonce, "base64").length >= 16 &&
    Buffer.from(nonce, "base64").toString("base64") === nonce, route + ": malformed or short nonce");
  const expected = new Map([
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", nonceTokens[0], "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(development ? ["ws:"] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["frame-src", ["'none'"]],
    ...(!development ? [["upgrade-insecure-requests", []]] : []),
  ]);
  assert.equal(directives.size, expected.size, route + ": unexpected or missing CSP directives");
  for (const [name, values] of expected) {
    const actual = directives.get(name);
    const distinct = new Set(actual);
    assert.ok(actual?.length === values.length && distinct.size === values.length &&
      values.every(value => distinct.has(value)), route + ": CSP directive " + name);
  }
  // Next's dynamic 404 adds stricter revalidation directives.
  const cache = asciiField(response.headers.get("cache-control"), route + ": expected ASCII Cache-Control")
    .split(",").map(value => value.trim().toLowerCase());
  const distinctCache = new Set(cache);
  const admitted = new Set(["no-store", "private", "max-age=0", "must-revalidate", "no-cache"]);
  assert.ok(distinctCache.has("no-store") && (development || distinctCache.has("private")) &&
    distinctCache.size === cache.length && cache.every(value => admitted.has(value)),
  route + ": nonce response must not be cached " + JSON.stringify(cache));
  return nonce;
}

export function assertOperatorDocument(html, { route, body, expectedStatus, nonce }) {
  const doc = assertHtmlDocument(html, { route, body });
  const head = child(doc, "head");
  const robots = [...elements(head)].filter(node => htmlElement(node, "meta") &&
    attr(node, "name")?.toLowerCase() === "robots");
  assert.ok(robots.length > 0 && robots.every(node => {
    const tokens = (attr(node, "content") ?? "").toLowerCase().split(/[,\s]+/);
    return tokens.includes("noindex") && !tokens.includes("index") && !tokens.includes("all");
  }),
  route + ": missing exact noindex metadata " + JSON.stringify(robots.map(node => attr(node, "content"))));
  const scripts = [...elements(doc)].filter(node => htmlElement(node, "script") && scriptKind(node));
  assert.ok(scripts.length > 0, route + ": no executable SSR scripts");
  for (const script of scripts) {
    assert.equal(attr(script, "nonce"), nonce, route + ": SSR script nonce mismatch");
  }
  if (expectedStatus === 404) {
    assert.ok([...elements(child(doc, "body"))].some(node => htmlElement(node, "a") &&
      attr(node, "href") === "/" && bodyText(node).trim() === "العودة إلى لوحة المشغّل"),
    route + ": missing safe Arabic recovery link");
  }
}

async function verifyResponse(response, route, expectedStatus, body, development, seenNonces) {
  assert.equal(response.status, expectedStatus, route + ": wrong status");
  assert.equal(mimeEssence(response), "text/html", route + ": not HTML");
  for (const [name, value] of [
    ["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()"],
    ["x-powered-by", null],
  ]) assert.equal(response.headers.get(name), value, route + ": header " + name);
  const nonce = assertOperatorPolicy(response, route, development);
  assert.ok(!seenNonces.has(nonce), route + ": repeated response nonce");
  seenNonces.add(nonce);
  assertOperatorDocument(await response.text(), { route, body, expectedStatus, nonce });
  return nonce;
}

export function operatorInvocation(args) {
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--dev"),
    "Use no arguments for the production build or --dev for the development host");
  const development = args[0] === "--dev";

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const app = path.join(root, "apps", "control-panel");
  const nextCli = path.join(app, "node_modules", "next", "dist", "bin", "next");
  assert.ok(existsSync(nextCli), "Install the existing frozen workspace dependencies first");
  if (!development) {
    assert.ok(existsSync(path.join(app, ".next", "BUILD_ID")),
      "Run pnpm --dir apps/control-panel build before the production HTTP smoke");
  }

  return { development, app, nextCli, mode: development ? "dev" : "start",
    env: { ...process.env, NODE_ENV: development ? "development" : "production", NEXT_TELEMETRY_DISABLED: "1" } };
}

// The child belongs to this disposable verification run. Observe its close even
// when spawn fails, and never leave the caller with an unconfirmed shutdown.
export async function withOperatorHost(executable, args, { cwd, env }, base, verify) {
  const server = spawn(executable, args, {
    cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let error;
  let output = "";
  let closed = false;
  const completion = new Promise(resolve => server.once("close", () => {
    closed = true;
    resolve();
  }));
  server.on("error", cause => { error = cause; });
  const collect = data => { output = (output + data).slice(-3000); };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  try {
    const expires = Date.now() + 30000;
    let ready = false;
    while (Date.now() < expires) {
      if (error || closed || server.exitCode !== null) {
        throw new Error("Operator host exited before readiness: " + (error?.message ?? output));
      }
      try {
        const response = await requestSsr(base + "/", { signal: AbortSignal.timeout(2500) });
        ready = response.status === 200;
        await response.arrayBuffer();
        if (ready) break;
      } catch {
        // The loopback listener may not have started yet.
      }
      await delay(250);
    }
    assert.ok(ready && !closed && !error, "Operator host readiness timed out: " + output);
    await verify();
  } finally {
    if (!closed) server.kill("SIGTERM");
    await Promise.race([completion, delay(3000)]);
    assert.ok(closed, "Operator host did not confirm shutdown");
  }
}

async function main(args) {
  const { development, app, nextCli, mode, env } = operatorInvocation(args);
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  await withOperatorHost(process.execPath, [nextCli, mode, "-H", "127.0.0.1", "-p", String(port)],
    { cwd: app, env }, base, async () => {
    const routes = [
      ["/", 200, "دخول المشغّل"],
      ["/workspace", 200, "الوصول إلى هذه المساحة غير متاح"],
      ["/health", 200, "واجهة لوحة التحكم متاحة. هذه الصفحة تفحص الواجهة فقط."],
      ["/lab", 404, "الصفحة غير موجودة"],
      ["/nonexistent-operator-route", 404, "الصفحة غير موجودة"],
    ];
    const seenNonces = new Set();
    for (const [route, expectedStatus, visibleText] of routes) {
      await verifyResponse(await requestSsr(base + route, {
        signal: AbortSignal.timeout(7000),
      }), route, expectedStatus, visibleText, development, seenNonces);
    }
    await verifyResponse(await requestSsr(base + "/", { signal: AbortSignal.timeout(7000) }),
      "/ repeated", 200, routes[0][2], development, seenNonces);
    const forged = await requestSsr(base + "/health", {
      signal: AbortSignal.timeout(7000),
      headers: { "x-nonce": "attacker-controlled", "Content-Security-Policy": "script-src 'unsafe-inline'" },
    });
    const forgedNonce = await verifyResponse(forged, "/health forged request", 200, routes[2][2], development, seenNonces);
    assert.notEqual(forgedNonce, "attacker-controlled", "client-supplied nonce was accepted");
    console.log("OPERATOR_" + (development ? "DEVELOPMENT" : "PRODUCTION") + "_HTTP_SMOKE_PASS routes=5 nonce_unique=7 forged_header_rejected=true script_csp=enforced unsafe_eval=" + (development ? "development_only" : "disabled") + " style_inline_exception=true browser_hydration=NOT_RUN");
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv.slice(2));