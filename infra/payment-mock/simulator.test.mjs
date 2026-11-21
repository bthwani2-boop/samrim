import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));
const mappingsDir = path.join(root, "mappings");

function allMappings() {
  return readdirSync(mappingsDir).filter((name) => name.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(mappingsDir, file), "utf8")));
}

test("synthetic payment image owns only fixed evidence fixtures", () => {
  const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM wiremock\/wiremock:3\.13\.2-2/m);
  assert.match(dockerfile, /^COPY mappings\/ \/home\/wiremock\/mappings\//m);
  const mappings = allMappings();
  assert.equal(mappings.length, 9);
  const urls = new Set();
  const ids = new Set();
  for (const mapping of mappings) {
    assert.equal(mapping.request.method, "GET");
    assert.match(mapping.request.url, /^\/sandbox\/v1\/funding\/cash-in-[a-z0-9-]+$/);
    assert.equal(mapping.priority, 5);
    assert.equal(mapping.response.headers["Content-Type"], "application/json");
    assert.equal(mapping.response.headers["Cache-Control"], "no-store");
    assert.ok(!urls.has(mapping.request.url), "ambiguous simulator request path");
    assert.ok(!ids.has(mapping.name), "ambiguous simulator mapping name");
    urls.add(mapping.request.url);
    ids.add(mapping.name);
    const reference = mapping.request.url.split("/").at(-1);
    const body = mapping.response.jsonBody;
    assert.deepEqual(Object.keys(body).sort(), ["actorId", "amountYer", "currency", "reference", "status"]);
    assert.equal(body.reference, reference);
    assert.match(body.amountYer, /^[1-9][0-9]*$/);
    assert.match(body.actorId, /^wallet-(one|two)$/);
    assert.ok(["SUCCEEDED", "PENDING", "FAILED"].includes(body.status));
    assert.ok([200, 302, 503].includes(mapping.response.status));
    assert.ok(!mapping.request.url.startsWith("/__admin"));
  }
  assert.ok(urls.has("/sandbox/v1/funding/cash-in-accepted-01"));
  assert.ok(urls.has("/sandbox/v1/funding/cash-in-pending-01"));
  assert.ok(urls.has("/sandbox/v1/funding/cash-in-failed-01"));
  assert.ok(urls.has("/sandbox/v1/funding/cash-in-delayed-01"));
});

test("only the explicitly confirmed fixture can credit the authorized synthetic Customer", () => {
  const valid = allMappings().filter((mapping) => {
    const evidence = mapping.response.jsonBody;
    return mapping.response.status === 200 &&
      !mapping.response.fixedDelayMilliseconds &&
      evidence.status === "SUCCEEDED" &&
      evidence.currency === "YER" &&
      evidence.actorId === "wallet-two" &&
      evidence.amountYer === "17" &&
      evidence.reference === mapping.request.url.split("/").at(-1);
  });
  assert.deepEqual(valid.map(({ response }) => response.jsonBody.reference), ["cash-in-accepted-01"]);
});
