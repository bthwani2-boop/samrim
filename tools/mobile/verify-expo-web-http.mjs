#!/usr/bin/env node
// Stage-4 production HTTP/SSR evidence for the two approved Expo Web hosts.
// This deliberately does NOT test Captain Web, native binaries, UI hydration,
// authentication, Store policy, or any external service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hosts = [
  { name: "customer", title: "بثواني — العميل", extraRoute: "/lab" },
  { name: "merchant", title: "بثواني — التاجر" },
];

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string", "Unable to allocate loopback port");
  await new Promise(resolve => socket.close(resolve));
  return address.port;
}

async function verifyHost({ name, title, extraRoute }) {
  const app = path.join(root, "apps", name);
  const expoCli = path.join(app, "node_modules", "expo", "bin", "cli");
  assert.ok(existsSync(expoCli), "Install the exact frozen Expo dependencies: " + name);
  assert.ok(existsSync(path.join(app, "dist", "server", "_expo", "server", "render.js")),
    "Build the approved Expo Web SSR output first: " + name);
  assert.ok(existsSync(path.join(app, "dist", "server", "_expo", "routes.json")),
    "Missing Expo Web SSR route manifest: " + name);

  const port = await unusedPort();
  const origin = "http://127.0.0.1:" + port;
  const proc = spawn(process.execPath, [expoCli, "serve", "--port", String(port)], {
    cwd: app,
    env: {
      ...process.env,
      NODE_ENV: "production",
      EXPO_NO_TELEMETRY: "1",
      EXPO_OFFLINE: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launchError;
  let log = "";
  proc.on("error", error => { launchError = error; });
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on("data", chunk => { log = (log + chunk.toString()).slice(-2200); });
  }

  try {
    let ready = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (launchError || proc.exitCode !== null) {
        throw new Error("Expo Web host exited before readiness (" + name + "): " +
          (launchError?.message ?? log));
      }
      try {
        const response = await fetch(origin + "/", { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) {
          await response.arrayBuffer();
          ready = true;
          break;
        }
      } catch {
        // The local listener may not be ready yet.
      }
      await delay(250);
    }
    assert.ok(ready, name + " did not become ready: " + log);

    const checks = [
      ["/", 200, title],
      ["/health", 200, "الملاحة التجريبية تعمل"],
      ["/not-a-real-stage4-route", 404, null],
    ];
    if (extraRoute) checks.push([extraRoute, 200, "مختبر مكونات Tamagui"]);

    for (const [route, status, text] of checks) {
      const response = await fetch(origin + route, {
        signal: AbortSignal.timeout(7000),
        redirect: "manual",
      });
      assert.equal(response.status, status, name + route + ": HTTP status");
      assert.match(response.headers.get("content-type") ?? "", /text\/html/i,
        name + route + ": HTML content type");
      const html = await response.text();
      if (text) {
        assert.match(html, /<html\b/i, name + route + ": missing HTML root");
        assert.match(html, /\blang="ar"/i, name + route + ": missing Arabic language");
        assert.match(html, /\bdir="rtl"/i, name + route + ": missing document RTL");
        assert.ok(html.includes(text), name + route + ": expected SSR text missing");
      }
    }
    console.log("EXPO_WEB_PRODUCTION_HTTP_PASS app=" + name +
      " routes=" + checks.length + " rtl=true browser_hydration=NOT_RUN");
  } finally {
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
    if (proc.exitCode === null) {
      await Promise.race([
        new Promise(resolve => proc.once("exit", resolve)),
        delay(3000),
      ]);
    }
  }
}

for (const host of hosts) await verifyHost(host);
console.log("EXPO_WEB_STAGE4_SMOKE_PASS hosts=2 native_captain_web=NOT_ADMITTED");
