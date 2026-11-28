import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { requestFunding, verifyProvider } from "./smoke.mjs";

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return server.address().port;
}

const directory = new URL("./mappings/", import.meta.url);
const fixtures = new Map(readdirSync(directory).filter(file => file.endsWith(".json")).map(file => {
  const mapping = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
  return [mapping.request.url, mapping.response];
}));

function serveFixtures(transform = response => response) {
  return async (req, res) => {
    const source = fixtures.get(req.url);
    if (!source) { res.writeHead(404).end(); return; }
    const response = transform(structuredClone(source));
    if (response.fixedDelayMilliseconds) await sleep(response.fixedDelayMilliseconds);
    if (res.destroyed) return;
    res.writeHead(response.status, response.headers).end(JSON.stringify(response.jsonBody));
  };
}

test("direct loopback client distinguishes connected deadline, refusal, reset and partial response", async t => {
  const port = await localServer(t, async (req, res) => {
    if (req.url.endsWith("/reset")) { res.destroy(); return; }
    if (req.url.endsWith("/partial")) { res.writeHead(200); res.write("partial"); }
    await sleep(600);
    if (!res.destroyed) res.end("late");
  });
  await assert.rejects(requestFunding(port, "delayed", 150), { code: "PAYMENT_CONNECTED_TIMEOUT" });
  await assert.rejects(requestFunding(port, "partial", 150), { code: "PAYMENT_REQUEST_TIMEOUT" });
  await assert.rejects(requestFunding(port, "reset", 1000), { code: "ECONNRESET" });
  const closed = createServer();
  await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  await assert.rejects(requestFunding(closedPort, "refused", 1000), { code: "ECONNREFUSED" });
  await assert.rejects(requestFunding(0, "invalid", 1000));
  await assert.rejects(requestFunding(port, "../outside", 1000));
});

test("all synthetic cases, actual connected deadline and recovery are required", async t => {
  const port = await localServer(t, serveFixtures());
  await verifyProvider(port);
});

test("adverse fixture responses reject status, identity, money, headers, redirect and delay drift", async t => {
  const cases = [
    response => { if (response.jsonBody.reference === "cash-in-accepted-01") response.jsonBody.actorId = "wrong"; return response; },
    response => { if (response.jsonBody.reference === "cash-in-accepted-01") response.jsonBody.amountYer = "18"; return response; },
    response => { if (response.jsonBody.reference === "cash-in-accepted-01") response.jsonBody.currency = "USD"; return response; },
    response => { if (response.jsonBody.reference === "cash-in-accepted-01") response.headers["Cache-Control"] = "public"; return response; },
    response => { if (response.jsonBody.reference === "cash-in-accepted-01") response.status = 201; return response; },
    response => { if (response.jsonBody.reference === "cash-in-redirect-01") response.headers.Location = "http://example.invalid/wrong"; return response; },
    response => { if (response.fixedDelayMilliseconds) delete response.fixedDelayMilliseconds; return response; }
  ];
  for (const transform of cases) {
    const port = await localServer(t, serveFixtures(transform));
    await assert.rejects(verifyProvider(port), /PAYMENT_/);
  }
});
