import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const file = new URL("../app/api/partners/roster/[actorId]/stores/route.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = ast.statements.filter((statement) =>
  ts.isFunctionDeclaration(statement) && ["validStoreCreation", "POST"].includes(statement.name?.text));
assert.equal(functions.length, 2, "exercise real Store validation and operator POST handler");
const runnable = ts.transpileModule(functions.map(node => node.getText(ast).replace(/^export\s+/, "")).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

const store = Object.freeze({
  name: "متجر تجريبي",
  relationModel: "INDEPENDENT_STORE",
  serviceCityId: "city-1", primaryVerticalId: "vertical-1",
  commercialStoreTypeId: "type-1", addressText: "عنوان متجر تجريبي",
  latitude: 15.3, longitude: 44.2,
  fulfillmentModes: ["CUSTOMER_PICKUP"],
});
const identity = { role: "operator", subject: "op-1", permissions: ["partners"] };

async function invoke(body = store, opts = {}) {
  const sent = [];
  const json = (payload, response = {}) => new Response(JSON.stringify(payload), {
    status: response.status ?? 200, headers: response.headers,
  });
  const { POST } = runInNewContext(runnable + "\n({ POST })", {
    Response, NextResponse: { json },
    errorResponse: (code, message, status) => json({ error: { code, message } }, { status }),
    verifySameOrigin: () => opts.sameOrigin !== false,
    readOperatorSession: async () => Object.hasOwn(opts, "identity") ? opts.identity : identity,
    operatorWorkspacePermissionDenied: (actor, permission) =>
      actor.permissions.includes(permission) ? null : json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    createOperatorMerchantStore: async (...args) => {
      sent.push(args);
      if (opts.upstreamError) throw opts.upstreamError;
      return { status: 201, payload: { storeId: "store-new", relationModel: body.relationModel, publicationState: "unpublished" } };
    },
    isDshClientError: (error) => Boolean(error?.kind === "http"),
    dshHttpStatus: (error) => error.status,
    dshErrorPayload: (error) => ({ code: error.code, message: "DSH rejected" }),
  });
  const req = new Request("http://localhost:13000/api/partners/roster/merchant-1/stores", {
    method: "POST", headers: {
      "Content-Type": "application/json", "Idempotency-Key": opts.key ?? "operator-store-key-001",
      "X-Correlation-ID": opts.correlation ?? "operator-store-corr-001",
    }, body: JSON.stringify(body),
  });
  const result = await POST(req, { params: Promise.resolve({ actorId: opts.owner ?? "merchant-1" }) });
  return { result, sent };
}

test("operator Store POST reaches exactly one canonical DSH writer with existing Merchant actor", async () => {
  const { result, sent } = await invoke();
  assert.equal(result.status, 201);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "merchant-1");
  assert.equal(sent[0][1].relationModel, "INDEPENDENT_STORE");
  assert.equal(sent[0][2].operatorActorId, "op-1");
  assert.equal(sent[0][2].idempotencyKey, "operator-store-key-001");
  assert.equal((await result.json()).publicationState, "unpublished");
});

test("missing session, wrong role, insufficient permissions and CSRF deny without reaching DSH", async () => {
  for (const [name, options, status] of [
    ["signed out", { identity: null }, 401],
    ["wrong role", { identity: { role: "partner", permissions: ["partners"] } }, 403],
    ["no partners grant", { identity: { role: "operator", permissions: [] } }, 403],
    ["wrong origin", { sameOrigin: false }, 403],
  ]) {
    const { result, sent } = await invoke(store, options);
    assert.equal(result.status, status, name);
    assert.equal(sent.length, 0, name);
  }
});

test("input, actor spoofing, bad location, unbounded keys and forbidden relation modes fail closed", async () => {
  const inputs = [
    { ...store, ownerActorId: "attacker" },
    { ...store, relationModel: "OTHER" },
    { ...store, latitude: 92 },
    { ...store, longitude: "44.2" },
    { ...store, fulfillmentModes: ["BTHWANI_CAPTAIN"] },
    { ...store, fulfillmentModes: ["CUSTOMER_PICKUP", "CUSTOMER_PICKUP"] },
    { ...store, serviceCityId: "" },
  ];
  for (const item of inputs) {
    const { result, sent } = await invoke(item);
    assert.equal(result.status, 400);
    assert.equal(sent.length, 0);
  }
  for (const options of [{ owner: "" }, { key: "short" }, { correlation: "tiny" }]) {
    const { result, sent } = await invoke(store, options);
    assert.equal(result.status, 400);
    assert.equal(sent.length, 0);
  }
});

test("DSH conflict is propagated without an automatic second mutation", async () => {
  const { result, sent } = await invoke(store, {
    upstreamError: { kind: "http", status: 409, code: "STORE_JOINING_CLOSED" },
  });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, "STORE_JOINING_CLOSED");
  assert.equal(sent.length, 1);
});
