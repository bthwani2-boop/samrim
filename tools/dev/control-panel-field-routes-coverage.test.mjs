import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";

const state = {
  identity: { subject: "operator-1", role: "operator", permissions: ["catalog", "partners", "finance", "platform_policies"] },
  permissionDenied: null,
  sameOrigin: true,
  calls: [],
  results: {},
  errors: {},
  identityResults: {},
};

function dshMethod(name) {
  return async (...args) => {
    state.calls.push({ name, args });
    if (state.errors[name]) throw state.errors[name];
    return state.results[name] ?? { status: 201, payload: { accepted: true } };
  };
}

const dshMethods = [
  "admitField",
  "approveFieldAdmission",
  "authorizeDshFieldReenrollment",
  "createCommercialStoreType",
  "createOperatorFieldAcquisitionRewardPolicy",
  "dshErrorPayload",
  "dshHttpStatus",
  "isDshClientError",
  "listCommercialStoreTypes",
  "listFieldAdmissions",
  "listOperatorFieldAcquisitionCases",
  "provisionFieldAdmission",
  "readFieldAdmissionByActor",
  "readOperatorFieldAcquisitionRewardPolicyByScope",
  "readOperatorPartnerStoreCommissionPolicies",
  "reviewFieldAdmissionProfile",
  "setDshFieldRoleEnabled",
  "setStoreCommercialType",
  "updateCommercialStoreType",
  "updateFieldAdmissionProfile",
  "updateOperatorPartnerStoreCommissionPolicy",
];

mock.module(new URL("../../apps/control-panel/src/server/dsh/dsh-bff.ts", import.meta.url).href, {
  exports: Object.fromEntries([
    ...dshMethods.map((name) => [name, name === "isDshClientError" ? (error) => Boolean(error?.kind) : name === "dshHttpStatus" ? (error) => error?.status ?? 502 : name === "dshErrorPayload" ? (error) => ({ code: error?.code ?? "DSH_INTERNAL_ERROR", message: error?.message ?? "dsh request failed" }) : dshMethod(name)]),
  ]),
});
mock.module(new URL("../../apps/control-panel/src/server/identity/identity-bff.ts", import.meta.url).href, {
  exports: {
    identityErrorPayload: (error) => ({ code: error?.code ?? "IDENTITY_ERROR", message: error?.message ?? "identity request failed" }),
    identityHttpStatus: (error) => error?.status ?? 502,
    readOperatorSession: async () => state.identity,
    searchIdentityRoles: async (...args) => {
      state.calls.push({ name: "searchIdentityRoles", args });
      if (state.errors.searchIdentityRoles) throw state.errors.searchIdentityRoles;
      return state.identityResults.searchIdentityRoles ?? { items: [], limit: 25, nextCursor: "" };
    },
  },
});
mock.module(new URL("../../apps/control-panel/src/server/identity/operator-workspace-access.ts", import.meta.url).href, {
  exports: {
    operatorWorkspacePermissionDenied: (identity, permission) => state.permissionDenied ?? (identity.permissions?.includes(permission) ? null : new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 })),
  },
});
mock.module(new URL("../../apps/control-panel/src/server/security/csrf.ts", import.meta.url).href, {
  exports: { verifySameOrigin: () => state.sameOrigin },
});
const nextResponseShim = `
export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { ...init, headers });
  }
}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: `data:text/javascript,${encodeURIComponent(nextResponseShim)}`, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const catalogTypes = await import("../../apps/control-panel/app/api/catalog/commercial-store-types/route.ts");
const catalogType = await import("../../apps/control-panel/app/api/catalog/commercial-store-types/[storeTypeId]/route.ts");
const storeCommercialType = await import("../../apps/control-panel/app/api/stores/[storeId]/commercial-type/route.ts");
const fieldCases = await import("../../apps/control-panel/app/api/fields/[fieldActorId]/acquisition-cases/route.ts");
const fieldRewardPolicy = await import("../../apps/control-panel/app/api/finance/field-acquisition-policy/route.ts");
const commissions = await import("../../apps/control-panel/app/api/finance/commercial-store-type-commission-policies/route.ts");
const fields = await import("../../apps/control-panel/app/api/fields/route.ts");

beforeEach(() => {
  state.identity = { subject: "operator-1", role: "operator", permissions: ["catalog", "partners", "finance", "platform_policies"] };
  state.permissionDenied = null;
  state.sameOrigin = true;
  state.calls = [];
  state.results = {};
  state.errors = {};
  state.identityResults = {};
});

function jsonRequest(method, url, body, headers = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

test("commercial store type list enforces access, scope, and maps service results", async () => {
  state.identity = null;
  assert.equal((await catalogTypes.GET(new Request("http://localhost/api/catalog/commercial-store-types?verticalId=food"))).status, 401);

  state.identity = { ...state.identity, role: "operator", permissions: [] };
  assert.equal((await catalogTypes.GET(new Request("http://localhost/api/catalog/commercial-store-types?verticalId=food&includeInactive=true"))).status, 403);

  state.identity = { subject: "operator-1", role: "operator", permissions: ["catalog"] };
  assert.equal((await catalogTypes.GET(new Request("http://localhost/api/catalog/commercial-store-types"))).status, 400);

  state.results.listCommercialStoreTypes = { storeTypes: [{ id: "type-1" }] };
  const response = await catalogTypes.GET(new Request("http://localhost/api/catalog/commercial-store-types?verticalId=food"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(state.calls.at(-1), { name: "listCommercialStoreTypes", args: [{ operatorActorId: "operator-1" }, "food", false] });

  state.errors.listCommercialStoreTypes = { kind: "http", status: 409, code: "VERSION_CONFLICT", message: "stale" };
  assert.equal((await catalogTypes.GET(new Request("http://localhost/api/catalog/commercial-store-types?verticalId=food"))).status, 409);
});

test("commercial store type create and update validate and normalize mutation contracts", async () => {
  state.sameOrigin = false;
  assert.equal((await catalogTypes.POST(jsonRequest("POST", "/api/catalog/commercial-store-types", {}))).status, 403);

  state.sameOrigin = true;
  assert.equal((await catalogTypes.POST(jsonRequest("POST", "/api/catalog/commercial-store-types", {}, { "Idempotency-Key": "short" }))).status, 400);
  const body = { verticalId: " food ", nameAr: " ملحمة ", nameEn: " Butcher ", active: true, reason: " Add type " };
  const created = await catalogTypes.POST(jsonRequest("POST", "/api/catalog/commercial-store-types", body, { "Idempotency-Key": "create-type-1" }));
  assert.equal(created.status, 201);
  const createCall = state.calls.at(-1);
  assert.equal(createCall.name, "createCommercialStoreType");
  assert.deepEqual(createCall.args[0], { verticalId: "food", nameAr: "ملحمة", nameEn: "Butcher", active: true, reason: "Add type" });
  assert.equal(createCall.args[1].operatorActorId, "operator-1");
  assert.match(createCall.args[1].correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(createCall.args[1].idempotencyKey, "create-type-1");

  const invalidUpdate = await catalogType.PATCH(jsonRequest("PATCH", "/api/catalog/commercial-store-types/type-1", { ...body, expectedVersion: 0 }, { "Idempotency-Key": "update-type-1" }), { params: Promise.resolve({ storeTypeId: "type-1" }) });
  assert.equal(invalidUpdate.status, 400);
  const updated = await catalogType.PATCH(jsonRequest("PATCH", "/api/catalog/commercial-store-types/type-1", { nameAr: " Local ", nameEn: " Local ", active: false, expectedVersion: 2, reason: " Retire type " }, { "Idempotency-Key": "update-type-1" }), { params: Promise.resolve({ storeTypeId: "type-1" }) });
  assert.equal(updated.status, 201);
  assert.equal(state.calls.at(-1).name, "updateCommercialStoreType");
  assert.deepEqual(state.calls.at(-1).args[0], "type-1");
  assert.deepEqual(state.calls.at(-1).args[1], { nameAr: "Local", nameEn: "Local", active: false, expectedVersion: 2, reason: "Retire type" });
});

test("store commercial type assignment and commission endpoints reject invalid requests and dispatch valid ones", async () => {
  const assignmentContext = { params: Promise.resolve({ storeId: "store-1" }) };
  const invalidAssignment = await storeCommercialType.POST(jsonRequest("POST", "/api/stores/store-1/commercial-type", { commercialStoreTypeId: "type-1", reason: "ok", expectedVersion: 0 }, { "Idempotency-Key": "assignment-key" }), assignmentContext);
  assert.equal(invalidAssignment.status, 400);
  const assignment = await storeCommercialType.POST(jsonRequest("POST", "/api/stores/store-1/commercial-type", { commercialStoreTypeId: " type-1 ", reason: " Assign type ", expectedVersion: 1 }, { "Idempotency-Key": "assignment-key" }), assignmentContext);
  assert.equal(assignment.status, 201);
  assert.deepEqual(state.calls.at(-1).args[0], "store-1");
  assert.deepEqual(state.calls.at(-1).args[1], { commercialStoreTypeId: "type-1", reason: "Assign type" });

  state.identity = { subject: "operator-1", role: "operator", permissions: [] };
  assert.equal((await commissions.GET(new Request("http://localhost/api/finance/commercial-store-type-commission-policies?commercialStoreTypeId=type-1"))).status, 403);
  state.identity.permissions = ["finance"];
  assert.equal((await commissions.GET(new Request("http://localhost/api/finance/commercial-store-type-commission-policies"))).status, 400);
  state.results.readOperatorPartnerStoreCommissionPolicies = { commercialStoreTypeId: "type-1", policies: [] };
  assert.equal((await commissions.GET(new Request("http://localhost/api/finance/commercial-store-type-commission-policies?commercialStoreTypeId=type-1"))).status, 200);

  state.sameOrigin = false;
  assert.equal((await commissions.POST(jsonRequest("POST", "/api/finance/commercial-store-type-commission-policies", {}))).status, 403);
  state.sameOrigin = true;
  const invalidCommission = await commissions.POST(jsonRequest("POST", "/api/finance/commercial-store-type-commission-policies", { commercialStoreTypeId: "type-1", fulfillmentMode: "UNKNOWN", commissionRateBps: 100, expectedVersion: 0, reason: "Opening rate" }, { "Idempotency-Key": "commission-key" }));
  assert.equal(invalidCommission.status, 400);
  const commission = await commissions.POST(jsonRequest("POST", "/api/finance/commercial-store-type-commission-policies", { commercialStoreTypeId: " type-1 ", fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 850, expectedVersion: 0, reason: " Opening rate " }, { "Idempotency-Key": "commission-key" }));
  assert.equal(commission.status, 201);
  assert.deepEqual(state.calls.at(-1).args[0], { commercialStoreTypeId: "type-1", fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 850, expectedVersion: 0, reason: "Opening rate" });
});

test("field reward policy and acquisition case routes protect scope and return canonical data", async () => {
  state.identity = null;
  assert.equal((await fieldRewardPolicy.GET(new Request("http://localhost/api/finance/field-acquisition-policy?scopeType=STORE_TYPE&scopeId=type-1"))).status, 401);
  state.identity = { subject: "operator-1", role: "operator", permissions: ["platform_policies", "partners"] };
  assert.equal((await fieldRewardPolicy.GET(new Request("http://localhost/api/finance/field-acquisition-policy?scopeType=PARTNER&scopeId=type-1"))).status, 400);
  state.results.readOperatorFieldAcquisitionRewardPolicyByScope = { policy: { id: "policy-1" } };
  assert.equal((await fieldRewardPolicy.GET(new Request("http://localhost/api/finance/field-acquisition-policy?scopeType=STORE_TYPE&scopeId=type-1"))).status, 200);

  const badPolicy = await fieldRewardPolicy.POST(jsonRequest("POST", "/api/finance/field-acquisition-policy", { scopeType: "STORE_TYPE", scopeId: "type-1", rewardMinor: 25, roundingUnitMinor: 50, expectedVersion: 0, reason: "Reason" }, { "Idempotency-Key": "reward-key-1" }));
  assert.equal(badPolicy.status, 400);
  const policy = await fieldRewardPolicy.POST(jsonRequest("POST", "/api/finance/field-acquisition-policy", { scopeType: " STORE_TYPE ", scopeId: " type-1 ", rewardMinor: 250, roundingUnitMinor: 50, expectedVersion: 0, reason: " Reward policy " }, { "Idempotency-Key": "reward-key-1" }));
  assert.equal(policy.status, 201);

  state.results.listOperatorFieldAcquisitionCases = { cases: [{ id: "case-1" }], nextCursor: "next" };
  const cases = await fieldCases.GET(new Request("http://localhost/api/fields/field-1/acquisition-cases?limit=10&q=shop"), { params: Promise.resolve({ fieldActorId: "field-1" }) });
  assert.equal(cases.status, 200);
  assert.equal(cases.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(state.calls.at(-1).args.slice(0, 3), ["field-1", "shop", 10]);
  const invalidCases = await fieldCases.GET(new Request("http://localhost/api/fields/field-1/acquisition-cases?limit=0"), { params: Promise.resolve({ fieldActorId: "field-1" }) });
  assert.equal(invalidCases.status, 400);
});

test("field registry supports candidate and account cursor phases", async () => {
  const invalid = await fields.GET(new Request("http://localhost/api/fields?scope=workbench&cursor=bad"));
  assert.equal(invalid.status, 400);

  state.results.listFieldAdmissions = { admissions: [{ id: "admission-1" }], nextCursor: "candidate-next" };
  const candidates = await fields.GET(new Request("http://localhost/api/fields?scope=workbench&limit=10&q=field"));
  const candidatePayload = await candidates.json();
  assert.equal(candidatePayload.items[0].admission.id, "admission-1");
  const cursor = Buffer.from(candidatePayload.nextCursor, "base64url").toString("utf8");
  assert.deepEqual(JSON.parse(cursor), { version: 1, phase: "candidates", sourceCursor: "candidate-next" });

  state.results.listFieldAdmissions = { admissions: [], nextCursor: "" };
  state.identityResults.searchIdentityRoles = { items: [{ actorId: "field-1" }], limit: 10, nextCursor: "account-next" };
  state.results.readFieldAdmissionByActor = { admission: null };
  const accounts = await fields.GET(new Request("http://localhost/api/fields?scope=workbench&limit=10&cursor=" + encodeURIComponent(Buffer.from(JSON.stringify({ version: 1, phase: "accounts", sourceCursor: "start" })).toString("base64url"))));
  const accountPayload = await accounts.json();
  assert.equal(accountPayload.items[0].account.actorId, "field-1");
  assert.equal(accountPayload.items[0].account.admission, null);
  assert.ok(accountPayload.nextCursor);
});

test("field admission dispatches supported transitions and rejects unknown actions", async () => {
  state.sameOrigin = false;
  assert.equal((await fields.POST(jsonRequest("POST", "/api/fields", { action: "admit" }))).status, 403);
  state.sameOrigin = true;
  const rejected = await fields.POST(jsonRequest("POST", "/api/fields", { action: "approve", admissionId: "admission-1", expectedVersion: 0 }));
  assert.equal(rejected.status, 400);

  const transitions = [
    { action: "approve", admissionId: "admission-1", expectedVersion: 1 },
    { action: "provision", admissionId: "admission-1" },
    { action: "review-profile", admissionId: "admission-1", expectedVersion: 1 },
    { action: "update-profile", admissionId: "admission-1", expectedVersion: 1, fullNameAr: "اسم ميداني" },
    { action: "activate", actorId: "field-1", expectedVersion: 1, reason: "Enable field" },
    { action: "disable", actorId: "field-1", expectedVersion: 1, reason: "Disable field" },
    { action: "reenroll", actorId: "field-1", expectedAdmissionVersion: 1, expectedActorVersion: 1, expectedRoleVersion: 1, reason: "Re-enroll field" },
    { action: "admit", fullNameAr: "اسم ميداني", contactPhoneE164: "+967700000000", serviceCityId: "sanaa" },
  ];
  for (const body of transitions) {
    const response = await fields.POST(jsonRequest("POST", "/api/fields", body));
    assert.ok(response.status === 201 || response.status === 204, `${body.action} returned ${response.status}`);
  }
  assert.equal(state.calls.length, transitions.length);

  const unknown = await fields.POST(jsonRequest("POST", "/api/fields", { action: "unknown" }));
  assert.equal(await errorCode(unknown), "INVALID_INPUT");
});
