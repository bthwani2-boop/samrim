import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const funding = "/sandbox/v1/funding/";
const expected = new Map([
  ["cash-in-accepted-01", [200, "wallet-two", "17", "YER", "SUCCEEDED"]],
  ["cash-in-delayed-01", [200, "wallet-two", "11", "YER", "SUCCEEDED"]],
  ["cash-in-failed-01", [200, "wallet-two", "11", "YER", "FAILED"]],
  ["cash-in-pending-01", [200, "wallet-two", "11", "YER", "PENDING"]],
  ["cash-in-redirect-01", [302, "wallet-two", "11", "YER", "SUCCEEDED"]],
  ["cash-in-server-error", [503, "wallet-two", "11", "YER", "SUCCEEDED"]],
  ["cash-in-wrong-actor", [200, "wallet-one", "11", "YER", "SUCCEEDED"]],
  ["cash-in-wrong-amount", [200, "wallet-two", "12", "YER", "SUCCEEDED"]],
  ["cash-in-wrong-currency", [200, "wallet-two", "11", "USD", "SUCCEEDED"]],
]);

function allMappings() {
  const directory = path.join(root, "mappings");
  return readdirSync(directory)
    .filter(name => name.endsWith(".json"))
    .map(file => JSON.parse(readFileSync(path.join(directory, file), "utf8")));
}

test("synthetic payment image owns exactly the admitted evidence fixtures", () => {
  const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^FROM wiremock\/wiremock:3\.13\.2-2@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /^COPY mappings\/ \/home\/wiremock\/mappings\/$/m);
  assert.match(dockerfile, /^USER 1000:1000$/m);
  const mappings = allMappings();
  assert.equal(mappings.length, expected.size);
  const remaining = new Set(expected.keys());
  const names = new Set();
  for (const mapping of mappings) {
    const reference = mapping.response.jsonBody.reference;
    assert.ok(remaining.delete(reference), "unexpected or duplicate fixture: " + reference);
    assert.ok(!names.has(mapping.name), "duplicate mapping name");
    names.add(mapping.name);
    assert.deepEqual(mapping.request, { method: "GET", url: funding + reference });
    assert.equal(mapping.priority, 5);
    const [status, actorId, amountYer, currency, state] = expected.get(reference);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (status === 302) headers.Location = "http://example.invalid/never-follow";
    assert.deepEqual(mapping.response, {
      status,
      headers,
      jsonBody: { reference, actorId, amountYer, currency, status: state },
      ...(reference === "cash-in-delayed-01" ? { fixedDelayMilliseconds: 2500 } : {}),
    });
  }
  assert.equal(remaining.size, 0);
});

test("only the explicitly confirmed fixture can credit the authorized synthetic Customer", () => {
  const valid = allMappings().filter(({ request, response }) => {
    const evidence = response.jsonBody;
    return response.status === 200 &&
      !response.fixedDelayMilliseconds &&
      evidence.status === "SUCCEEDED" &&
      evidence.currency === "YER" &&
      evidence.actorId === "wallet-two" &&
      evidence.amountYer === "17" &&
      request.url === funding + evidence.reference;
  });
  assert.deepEqual(valid.map(({ response }) => response.jsonBody.reference), ["cash-in-accepted-01"]);
});

test("provider build context excludes test harnesses and nonfixture files", () => {
  const rules = readFileSync(path.join(root, ".dockerignore"), "utf8")
    .split(/\r?\n/).filter(line => line && !line.startsWith("#"));
  assert.deepEqual(rules, ["**", "!mappings/cash-in-*.json"]);
});
