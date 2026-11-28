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

function serveFixtures(transform = response => response, missingHeaders = {}) {
  return async (req, res) => {
    const source = fixtures.get(req.url);
    if (!source) { res.writeHead(404, missingHeaders).end(); return; }
    const response = transform(structuredClone(source));
    if (response.fixedDelayMilliseconds) await sleep(response.fixedDelayMilliseconds);
    if (res.destroyed) return;
    if (response.wireTrailers && response.announceTrailers !== false) {
      response.headers.Trailer = Object.keys(response.wireTrailers).join(", ");
    }
    res.writeHead(response.status, response.headers);
    if (response.wireTrailers) res.addTrailers(response.wireTrailers);
    res.end(response.wireBody ?? JSON.stringify(response.jsonBody));
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

test("wire-level field occurrences cannot be hidden by normalized HTTP headers", async t => {
  const cases = [
    ["cash-in-accepted-01", "Content-Type", "text/html"],
    ["cash-in-accepted-01", "Content-Type", "application/json"],
    ["cash-in-accepted-01", "Cache-Control", "public"],
    ["cash-in-redirect-01", "Location", "http://example.invalid/wrong"],
    ["cash-in-redirect-01", "Location", "http://example.invalid/never-follow"]
  ];
  for (const [reference, field, extra] of cases) {
    await t.test(reference + " duplicate " + field + " " + extra, async sub => {
      const port = await localServer(sub, serveFixtures(response => {
        if (response.jsonBody.reference === reference) {
          response.headers[field] = [response.headers[field], extra];
        }
        return response;
      }));
      await assert.rejects(verifyProvider(port), /PAYMENT_HEADER/);
    });
  }
});

test("nonredirect and missing fixtures cannot advertise a redirect destination", async t => {
  const port = await localServer(t, serveFixtures(response => {
    if (response.jsonBody.reference === "cash-in-accepted-01") {
      response.headers.Location = "http://example.invalid/wrong";
    }
    return response;
  }));
  await assert.rejects(verifyProvider(port), /PAYMENT_REDIRECT/);
  const missing = await localServer(t, serveFixtures(undefined, { Location: "http://example.invalid/wrong" }));
  await assert.rejects(verifyProvider(missing), /PAYMENT_MISSING_REDIRECT/);
});

test("complete fixture representation rejects late controls, false coding and lossy JSON", async t => {
  const cases = [
    ["media trailer", response => { response.wireTrailers = { "Content-Type": "text/html" }; }, /PAYMENT_TRAILER/],
    ["cache trailer", response => { response.wireTrailers = { "Cache-Control": "public" }; }, /PAYMENT_TRAILER/],
    ["encoding trailer", response => { response.wireTrailers = { "Content-Encoding": "gzip" }; }, /PAYMENT_TRAILER/],
    ["unannounced location trailer", response => {
      response.wireTrailers = { Location: "http://example.invalid/wrong" };
      response.announceTrailers = false;
    }, /PAYMENT_TRAILER/],
    ["false encoding", response => { response.headers["Content-Encoding"] = "gzip"; }, /PAYMENT_ENCODING/],
    ["duplicate value", response => {
      response.wireBody = '{"status":"FAILED",' + JSON.stringify(response.jsonBody).slice(1);
    }, /PAYMENT_BODY_MEMBERS/],
    ["duplicate escaped name", response => {
      response.wireBody = '{"statu\\u0073":null,' + JSON.stringify(response.jsonBody).slice(1);
    }, /PAYMENT_BODY_MEMBERS/],
    ["overwritten nested value", response => {
      response.wireBody = '{"status":{"nested":"colon: inside string"},' + JSON.stringify(response.jsonBody).slice(1);
    }, /PAYMENT_BODY_MEMBERS/],
    ["invalid UTF-8 in overwritten value", response => {
      response.wireBody = Buffer.concat([
        Buffer.from('{"status":"'), Buffer.from([0xff]),
        Buffer.from('",' + JSON.stringify(response.jsonBody).slice(1))
      ]);
    }, /PAYMENT_RESPONSE_UTF8/]
  ];
  for (const [name, mutate, error] of cases) {
    await t.test(name, async sub => {
      const port = await localServer(sub, serveFixtures(response => {
        if (response.jsonBody.reference === "cash-in-accepted-01") mutate(response);
        return response;
      }));
      await assert.rejects(verifyProvider(port), error);
    });
  }
});

test("equivalent JSON ordering, escaping, spacing and benign trailers remain admissible", async t => {
  const port = await localServer(t, serveFixtures(response => {
    if (response.jsonBody.reference === "cash-in-accepted-01") {
      const reordered = Object.fromEntries(Object.entries(response.jsonBody).reverse());
      response.wireBody = JSON.stringify(reordered, null, 2).replace('"status"', '"statu\\u0073"');
      response.wireTrailers = { "Server-Timing": "mock;dur=1" };
    }
    return response;
  }));
  await verifyProvider(port);
});
