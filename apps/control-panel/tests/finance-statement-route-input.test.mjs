import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app/api/finance/financial-statements/route.ts", import.meta.url), "utf8");
const runtime = stripTypeScriptTypes(
  source.replace(/^import[^\n]*\n/gm, "").replace("export async function GET", "async function GET"),
);
const scope = {
  URL,
  identity: { role: "operator", subject: "authorized-operator", permissions: ["finance"] },
  calls: [],
  NextResponse: { json: (payload, options = {}) => ({ status: options.status ?? 200, payload }) },
  readOperatorSession: async () => scope.identity,
  listOperatorFinancialStatementSummaries: async (...args) => {
    scope.calls.push(args);
    return { actorType: "partner", summaries: [], totals: {}, limit: 200 };
  },
  isDshClientError: () => false,
  dshErrorPayload: () => ({ code: "DSH_ERROR" }),
  dshHttpStatus: () => 502,
};
runInNewContext(`${runtime}\nglobalThis.routeGET = GET;`, scope);
const endpoint = "http://localhost:13000/api/finance/financial-statements";
async function request(query, identity = { role: "operator", subject: "authorized-operator", permissions: ["finance"] }) {
  scope.identity = identity;
  scope.calls = [];
  return await scope.routeGET(new Request(endpoint + (query ? `?${query}` : "")));
}

test("anonymous and operator without finance permission cannot read financial statements", async () => {
  assert.equal((await request("actorType=partner&from=2020-01-01&to=2026-11-11", null)).status, 401);
  assert.equal(scope.calls.length, 0);
  assert.equal((await request("actorType=partner&from=2020-01-01&to=2026-11-11",
    { role: "operator", subject: "operator", permissions: ["partners"] })).status, 403);
  assert.equal(scope.calls.length, 0);
});

test("invalid actor type fails closed with HTTP 400 before DSH request", async () => {
  const response = await request("actorType=invalid&from=2020-01-01&to=2026-11-11");
  assert.equal(response.status, 400);
  assert.equal(scope.calls.length, 0);
});

test("missing, malformed and inverted finance reporting dates return HTTP 400, never 500", async () => {
  for (const query of [
    "actorType=partner",
    "actorType=partner&from=2020-01-01",
    "actorType=partner&from=2020-01-01&to=not-a-date",
    "actorType=partner&from=2099-01-01&to=2020-01-01",
  ]) {
    const response = await request(query);
    assert.equal(response.status, 400, query);
    assert.equal(scope.calls.length, 0, query);
  }
});

test("valid authorized read uses original actor, range and canonical DSH owner", async () => {
  const response = await request("actorType=partner&from=2020-01-01&to=2026-11-11");
  assert.equal(response.status, 200);
  assert.equal(scope.calls.length, 1);
  assert.equal(scope.calls[0][0], "partner");
  assert.equal(scope.calls[0][1], "2020-01-01");
  assert.equal(scope.calls[0][2], "2026-11-11");
  assert.equal(scope.calls[0][3], "");
  assert.equal(scope.calls[0][4].operatorActorId, "authorized-operator");
});
