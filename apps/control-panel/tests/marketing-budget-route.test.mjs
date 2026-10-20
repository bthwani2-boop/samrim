import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real Next.js handler logic without a live operator session or
// modifying DSH state. The DSH BFF boundary is replaced by a capturing stub.
const routeFile = path.resolve(import.meta.dirname, "../app/api/marketing/promotions/route.ts");
const source = readFileSync(routeFile, "utf8");
const ast = ts.createSourceFile(routeFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const handler = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "POST");
assert.ok(handler, "POST marketing promotion route must exist");
const transpiled = ts.transpileModule(handler.getText(ast).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const minimalPromotion = Object.freeze({
  id: "promotion-budget-route-test",
  code: "BUDGET10",
  nameAr: "عرض ميزانية تجريبي",
  kind: "FIXED",
  valueMinor: 100,
  fundingSource: "BTHWANI",
  startsAt: "2026-11-01T00:00:00.000Z",
});

async function invoke(input) {
  let submitted;
  const nextJSON = (value, options = {}) => new Response(JSON.stringify(value), { status: options.status ?? 200 });
  const POST = vm.runInNewContext(transpiled + "\nPOST", {
    randomUUID,
    verifySameOrigin: () => true,
    readOperatorSession: async () => ({ role: "operator", subject: "budget-test", permissions: ["marketing"] }),
    operatorWorkspacePermissionDenied: () => null,
    errorResponse: (code, message, status) => nextJSON({ error: { code, message } }, { status }),
    NextResponse: { json: nextJSON },
    createMarketingPromotion: async (promotion) => {
      submitted = promotion;
      return { payload: { promotion }, status: 201 };
    },
    isDshClientError: () => false,
  });
  const request = new Request("http://localhost:13000/api/marketing/promotions", {
    method: "POST",
    headers: { "Idempotency-Key": "budget-route-test-0001", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const response = await POST(request);
  return { response, submitted };
}

test("operator promotion budget reaches DSH unchanged", async () => {
  const { response, submitted } = await invoke({ ...minimalPromotion, discountBudgetLimitMinor: 300 });
  assert.equal(response.status, 201);
  assert.equal(submitted.discountBudgetLimitMinor, 300);
  assert.equal(submitted.fundingSource, "BTHWANI");
});

test("invalid monetary caps never fall back to an uncapped promotion", async () => {
  for (const invalid of [0, -1, 1.5, "300", Number.MAX_SAFE_INTEGER + 1]) {
    const { response, submitted } = await invoke({ ...minimalPromotion, discountBudgetLimitMinor: invalid });
    assert.equal(response.status, 400);
    assert.equal(submitted, undefined);
    const payload = await response.json();
    assert.equal(payload.error.code, "INVALID_INPUT");
  }
});

test("absent cap remains explicitly unbounded; no invented budget", async () => {
  const { response, submitted } = await invoke(minimalPromotion);
  assert.equal(response.status, 201);
  assert.equal(Object.hasOwn(submitted, "discountBudgetLimitMinor"), false);
});

test("invalid optional redemption, minimum order, and per-order discount limits never disappear silently", async () => {
  for (const field of ["redemptionLimit", "minOrderSubtotalMinor", "maxDiscountMinor"]) {
    for (const invalid of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1]) {
      const { response, submitted } = await invoke({ ...minimalPromotion, [field]: invalid });
      assert.equal(response.status, 400, `${field}=${invalid} must be rejected`);
      assert.equal(submitted, undefined, `${field}=${invalid} must not reach DSH`);
      assert.equal((await response.json()).error.code, "INVALID_INPUT");
    }
  }
});

test("valid optional redemption, minimum order, and discount limits reach DSH intact", async () => {
  const limits = { redemptionLimit: 5, minOrderSubtotalMinor: 2000, maxDiscountMinor: 300 };
  const { response, submitted } = await invoke({ ...minimalPromotion, kind: "PERCENTAGE", ...limits });
  assert.equal(response.status, 201);
  for (const field of Object.keys(limits)) assert.equal(submitted[field], limits[field]);
});
