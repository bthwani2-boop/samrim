import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module(new URL("../../services/dsh/clients/index.ts", import.meta.url).href, {
  exports: {
    isMediaProvenanceInputValid: () => true,
    dshOperationPaths: {
      listCommercialStoreTypes: { method: "GET", path: "/dsh/catalog/commercial-store-types" },
      createCommercialStoreType: { method: "POST", path: "/dsh/catalog/commercial-store-types" },
      updateCommercialStoreType: { method: "PATCH", path: "/dsh/catalog/commercial-store-types/{storeTypeId}" },
      readOperatorCommercialStoreTypeCommissionPolicies: { method: "GET", path: "/dsh/operator/commercial-store-type-commission-policies" },
      updateOperatorCommercialStoreTypeCommissionPolicy: { method: "POST", path: "/dsh/operator/commercial-store-type-commission-policies" },
      createFieldAcquisitionRewardPolicy: { method: "POST", path: "/dsh/operator/field-acquisition-reward-policies" },
      readFieldAcquisitionRewardPolicyByScope: { method: "GET", path: "/dsh/operator/field-acquisition-reward-policies" },
    },
  },
});
mock.module(new URL("../../services/identity/clients/index.ts", import.meta.url).href, {
  exports: {
    validateServiceUrl(value) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("service URL must use HTTPS");
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    },
  },
});

const {
  createCommercialStoreType,
  createOperatorFieldAcquisitionRewardPolicy,
  dshErrorPayload,
  dshHttpStatus,
  isDshClientError,
  listCommercialStoreTypes,
  readOperatorFieldAcquisitionRewardPolicyByScope,
  readOperatorPartnerStoreCommissionPolicies,
  updateCommercialStoreType,
  updateOperatorPartnerStoreCommissionPolicy,
} = await import("../../apps/control-panel/src/server/dsh/dsh-bff.ts");

const operator = Object.freeze({ operatorActorId: "operator-1" });
const mutation = Object.freeze({ operatorActorId: "operator-1", correlationId: "correlation-1", idempotencyKey: "idempotency-1" });
const serviceToken = "coverage-service-token-24-characters";

function configureDsh(t, fetchImplementation) {
  const previousUrl = process.env.DSH_API_BASE_URL;
  const previousToken = process.env.CONTROL_PANEL_SERVICE_TOKEN;
  process.env.DSH_API_BASE_URL = "https://dsh.example.com";
  process.env.CONTROL_PANEL_SERVICE_TOKEN = serviceToken;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.DSH_API_BASE_URL;
    else process.env.DSH_API_BASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.CONTROL_PANEL_SERVICE_TOKEN;
    else process.env.CONTROL_PANEL_SERVICE_TOKEN = previousToken;
  });
  return t.mock.method(globalThis, "fetch", fetchImplementation);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

test("commercial taxonomy and finance BFF calls keep DSH request contracts", async (t) => {
  const requests = [];
  configureDsh(t, async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const created = init.method === "POST" && ["/dsh/catalog/commercial-store-types", "/dsh/operator/field-acquisition-reward-policies"].includes(url.pathname);
    return jsonResponse({ accepted: true }, created ? 201 : 200);
  });

  await listCommercialStoreTypes(operator, "food vertical", true);
  const createdType = await createCommercialStoreType({ verticalId: "food", nameAr: "ملحمة", nameEn: "Butcher", active: true, reason: "Add local butcher" }, mutation);
  const updatedType = await updateCommercialStoreType("type/one", { nameAr: "ملحمة محلية", nameEn: "Local Butcher", active: false, expectedVersion: 1, reason: "Retire unused type" }, mutation);
  await readOperatorPartnerStoreCommissionPolicies("type-1", operator);
  const updatedPolicy = await updateOperatorPartnerStoreCommissionPolicy({ commercialStoreTypeId: " type-1 ", fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 850, expectedVersion: 0, reason: "Opening delivery rate" }, mutation);
  await createOperatorFieldAcquisitionRewardPolicy({ scopeType: "STORE_TYPE", scopeId: " type-1 ", rewardMinor: 1250, roundingUnitMinor: 50, expectedVersion: 0, reason: "Field acquisition reward" }, mutation);
  await readOperatorFieldAcquisitionRewardPolicyByScope({ scopeType: "STORE_TYPE", scopeId: " type-1 " }, operator);

  assert.equal(createdType.status, 201);
  assert.equal(updatedType.status, 200);
  assert.equal(updatedPolicy.status, 200);
  assert.equal(requests.length, 7);

  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].url.pathname, "/dsh/catalog/commercial-store-types");
  assert.equal(requests[0].url.searchParams.get("verticalId"), "food vertical");
  assert.equal(requests[0].url.searchParams.get("includeInactive"), "true");
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${serviceToken}`);
  assert.equal(requests[0].init.headers["X-Acting-Actor-ID"], operator.operatorActorId);

  assert.equal(requests[1].url.pathname, "/dsh/catalog/commercial-store-types");
  assert.equal(requests[1].body.nameAr, "ملحمة");
  assert.equal(requests[1].init.headers["Idempotency-Key"], mutation.idempotencyKey);
  assert.equal(requests[2].url.pathname, "/dsh/catalog/commercial-store-types/type%2Fone");
  assert.equal(requests[2].body.expectedVersion, 1);

  assert.equal(requests[3].url.pathname, "/dsh/operator/commercial-store-type-commission-policies");
  assert.equal(requests[3].url.searchParams.get("commercialStoreTypeId"), "type-1");
  assert.equal(requests[4].body.commercialStoreTypeId, "type-1");
  assert.equal(requests[4].body.reason, "Opening delivery rate");
  assert.equal(requests[4].init.headers["X-Correlation-ID"], mutation.correlationId);
  assert.equal(requests[5].url.pathname, "/dsh/operator/field-acquisition-reward-policies");
  assert.equal(requests[5].body.scopeId, "type-1");
  assert.equal(requests[6].url.searchParams.get("scopeType"), "STORE_TYPE");
  assert.equal(requests[6].url.searchParams.get("scopeId"), "type-1");
});

test("commercial taxonomy and finance BFF reject invalid requests before transport", async (t) => {
  let calls = 0;
  configureDsh(t, async () => {
    calls += 1;
    return jsonResponse({ accepted: true });
  });

  await assert.rejects(listCommercialStoreTypes({ operatorActorId: " " }, "food"), /DSH_COMMERCIAL_STORE_TYPE_READ_INPUT_INVALID/);
  await assert.rejects(createCommercialStoreType({ verticalId: "food", nameAr: " ", nameEn: "Butcher", active: true, reason: "Add type" }, mutation), /DSH_COMMERCIAL_STORE_TYPE_INPUT_INVALID/);
  await assert.rejects(updateCommercialStoreType(" ", { nameAr: "Butcher", nameEn: "Butcher", active: true, expectedVersion: 1, reason: "Rename type" }, mutation), /DSH_COMMERCIAL_STORE_TYPE_UPDATE_INPUT_INVALID/);
  await assert.rejects(readOperatorPartnerStoreCommissionPolicies(" ", operator), /DSH_COMMERCIAL_STORE_TYPE_COMMISSION_POLICY_READ_INPUT_INVALID/);
  await assert.rejects(updateOperatorPartnerStoreCommissionPolicy({ commercialStoreTypeId: "type-1", fulfillmentMode: "UNKNOWN", commissionRateBps: 850, expectedVersion: 0, reason: "Opening delivery rate" }, mutation), /DSH_COMMERCIAL_STORE_TYPE_COMMISSION_POLICY_INPUT_INVALID/);
  await assert.rejects(createOperatorFieldAcquisitionRewardPolicy({ scopeType: "STORE_TYPE", scopeId: "type-1", rewardMinor: 25, roundingUnitMinor: 50, expectedVersion: 0, reason: "Too small" }, mutation), /DSH_FIELD_ACQUISITION_REWARD_POLICY_INPUT_INVALID/);
  await assert.rejects(readOperatorFieldAcquisitionRewardPolicyByScope({ scopeType: "STORE_TYPE", scopeId: " " }, operator), /DSH_FIELD_ACQUISITION_REWARD_POLICY_READ_INPUT_INVALID/);
  await assert.rejects(createCommercialStoreType({ verticalId: "food", nameAr: "Butcher", nameEn: "Butcher", active: true, reason: "Add type" }, { ...mutation, idempotencyKey: " " }), /DSH_COMMERCIAL_STORE_TYPE_IDEMPOTENCY_INVALID/);
  assert.equal(calls, 0);
});

test("DSH BFF maps HTTP, network, and service configuration failures", async (t) => {
  const request = configureDsh(t, async () => jsonResponse({ error: { code: "VERSION_CONFLICT", message: "refresh the policy" } }, 409));
  await assert.rejects(
    listCommercialStoreTypes(operator, "food"),
    (error) => isDshClientError(error) && dshHttpStatus(error) === 409 && dshErrorPayload(error).code === "VERSION_CONFLICT" && dshErrorPayload(error).message === "refresh the policy",
  );
  assert.equal(request.mock.callCount(), 1);

  request.mock.mockImplementation(async () => {
    throw new Error("socket closed");
  });
  await assert.rejects(
    listCommercialStoreTypes(operator, "food"),
    (error) => isDshClientError(error) && dshHttpStatus(error) === 502 && dshErrorPayload(error).code === "DSH_UNAVAILABLE",
  );

  request.mock.restore();
  process.env.DSH_API_BASE_URL = "http://dsh.example.com";
  await assert.rejects(
    listCommercialStoreTypes(operator, "food"),
    (error) => isDshClientError(error) && dshHttpStatus(error) === 500 && dshErrorPayload(error).code === "DSH_CONFIG_ERROR",
  );

  process.env.DSH_API_BASE_URL = "https://dsh.example.com";
  process.env.CONTROL_PANEL_SERVICE_TOKEN = "short";
  await assert.rejects(
    listCommercialStoreTypes(operator, "food"),
    (error) => isDshClientError(error) && dshHttpStatus(error) === 500 && dshErrorPayload(error).code === "DSH_CONFIG_ERROR",
  );

  assert.deepEqual(dshErrorPayload(new Error("unexpected")), { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" });
  assert.equal(dshHttpStatus(new Error("unexpected")), 502);
});
