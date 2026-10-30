import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const routeFiles = {
  destination: new URL("../app/api/finance/actor-destination/route.ts", import.meta.url),
  intent: new URL("../app/api/finance/actor-destination/intent/route.ts", import.meta.url),
  verify: new URL("../app/api/finance/actor-destination/verify/route.ts", import.meta.url),
  activate: new URL("../app/api/finance/actor-destination/activate/route.ts", import.meta.url),
};
const validBody = { changeReason: "reason", verificationEvidenceReference: "verified", changeEvidenceReference: "changed" };
const operator = { role: "operator", permissions: ["finance"], subject: "operator" };

function compileFunctions(file, names, includeConsts = false) {
  const src = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(String(file), src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = ast.statements.filter((s) => (
    ts.isFunctionDeclaration(s) && names.includes(s.name?.text)
  ) || (includeConsts && ts.isVariableStatement(s) &&
    s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && /^destination(Read|Create)ActorTypes$/.test(d.name.text))));
  const js = ts.transpileModule(nodes.map((s) => s.getText(ast).replace(/^export\s+/, "")).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return js;
}

async function invoke(key, method, actorType, session = operator) {
  const calls = [];
  const nextJSON = (data, opts = {}) => new Response(JSON.stringify(data), { status: opts.status ?? 200, headers: opts.headers });
  const ctx = {
    randomUUID, URL, NextResponse: { json: nextJSON },
    readOperatorSession: async () => session,
    readOperatorDestination: async (...args) => { calls.push(["read", ...args]); return { destination: { id: "old" } }; },
    readOperatorWalletProviderIntent: async (...args) => { calls.push(["intent", ...args]); return { intent: { actorType: args[0], actorId: args[1] } }; },
    createOperatorDestination: async (...args) => { calls.push(["create", ...args]); return { payload: { destination: {} } }; },
    verifyOperatorDestination: async (...args) => { calls.push(["verify", ...args]); return { destination: {} }; },
    activateOperatorDestination: async (...args) => { calls.push(["activate", ...args]); return { destination: {} }; },
    isDshClientError: () => false,
  };
  const names = ["operator", "mapError", "GET", "POST"];
  const compiled = compileFunctions(routeFiles[key], names, true);
  const handlers = vm.runInNewContext(compiled + "\n({ GET: typeof GET === 'function' ? GET : null, POST: typeof POST === 'function' ? POST : null })", ctx);
  const query = new URLSearchParams({ actorType, actorId: "actor-1", destinationId: "destination-1" });
  const req = new Request("http://localhost/api/finance/actor-destination?" + query.toString(), {
    method,
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" },
      body: JSON.stringify(key === "destination" ? validBody : key === "verify" ? { evidenceReference: "evidence" } : {}) } : {}),
  });
  const res = await handlers[method](req);
  return { res, calls };
}

const flows = [["destination", "GET"], ["destination", "POST"], ["intent", "GET"], ["verify", "POST"], ["activate", "POST"]];

test("Field is rejected by each actual BFF route without a single DSH call", async () => {
  for (const [name, method] of flows) {
    const { res, calls } = await invoke(name, method, "field");
    assert.equal(res.status, 400, name + "/" + method);
    assert.equal((await res.json()).error.code, "INVALID_INPUT");
    assert.equal(calls.length, 0);
  }
});

test("partner/captain destination flows still forward exactly once", async () => {
  for (const actorType of ["partner", "captain"]) {
    for (const [name, method] of flows) {
      const { res, calls } = await invoke(name, method, actorType);
      assert.ok(res.ok, name + "/" + method);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1], actorType);
    }
  }
});

test("customer can read destination, never mutate; unauthenticated/unauthorized calls are blocked", async () => {
  assert.equal((await invoke("destination", "GET", "customer")).res.status, 200);
  for (const key of ["destination", "verify", "activate"]) {
    const { res, calls } = await invoke(key, "POST", "customer");
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  }
  for (const [identity, status] of [[null, 401], [{ role: "operator", permissions: [], subject: "op" }, 403]]) {
    for (const [name, method] of flows) {
      const { res, calls } = await invoke(name, method, "partner", identity);
      assert.equal(res.status, status);
      assert.equal(calls.length, 0);
    }
  }
});

test("DSH BFF client functions reject retired Field at runtime even without route guard", async () => {
  const file = new URL("../src/server/dsh/dsh-bff.ts", import.meta.url);
  const names = ["readOperatorDestination", "readOperatorWalletProviderIntent", "createOperatorDestination", "verifyOperatorDestination", "activateOperatorDestination"];
  const calls = [];
  const ctx = {
    dshOperationPaths: {}, validateAttributedMutationContext: () => {},
    requestDshJson: (...args) => { calls.push(args); return Promise.resolve({ payload: {} }); },
  };
  const fns = vm.runInNewContext(compileFunctions(file, names) + "\n({" + names.join(",") + "})", ctx);
  const mutation = { operatorActorId: "op", correlationId: "corr", idempotencyKey: "idem" };
  const valid = { changeReason: "reason", verificationEvidenceReference: "ref", changeEvidenceReference: "ref" };
  for (const name of names) {
    const invoke = name === "createOperatorDestination" ? () => fns[name]("field", "id", valid, mutation)
      : name === "verifyOperatorDestination" ? () => fns[name]("field", "id", "dest", "evidence", mutation)
      : name === "activateOperatorDestination" ? () => fns[name]("field", "id", "dest", mutation)
      : () => fns[name]("field", "id", mutation);
    await assert.rejects(invoke(), /INPUT_INVALID/, name);
    assert.equal(calls.length, 0);
  }
});

test("Field historical finance remains visible without the destination editor", () => {
  const registry = readFileSync(new URL("../src/features/finance/beneficiary-settlement-workspace.tsx", import.meta.url), "utf8");
  const inbox = readFileSync(new URL("../src/features/finance/settlement-intake-inbox.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../src/features/finance/official-wallet-destination-manager.tsx", import.meta.url), "utf8");
  assert.match(registry, /وجهة صرف الميداني معروضة للسجلات التاريخية/);
  assert.doesNotMatch(registry, /OfficialWalletDestinationManager actorType="field"/);
  assert.match(inbox, /selected\.actorType === "field" \? <p role="status"/);
  assert.match(manager, /type BeneficiaryActorType = "partner" \| "captain";/);
});
