import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validate } from "./check-openapi.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function mutate(owner, name, transform) {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-openapi-"));
  try {
    const relative = `services/${owner}/contracts/openapi`;
    cpSync(path.join(root, relative), path.join(tmp, relative), { recursive: true });
    const file = path.join(tmp, relative, name);
    const original = readFileSync(file, "utf8");
    const next = transform(original);
    assert.notEqual(original, next, "Fixture must actually change");
    writeFileSync(file, next, "utf8");
    return validate(owner, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function mutateOwnerFiles(owner, changes) {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-openapi-linked-"));
  try {
    const relative = `services/${owner}/contracts/openapi`;
    cpSync(path.join(root, relative), path.join(tmp, relative), { recursive: true });
    for (const [name, transform] of Object.entries(changes)) {
      const file = path.join(tmp, relative, name);
      const original = readFileSync(file, "utf8");
      const next = transform(original);
      assert.notEqual(original, next, `Fixture must change ${name}`);
      writeFileSync(file, next, "utf8");
    }
    return validate(owner, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function hasError(result, fragment) {
  assert.ok(result.errors.some((error) => error.includes(fragment)),
    `Expected ${JSON.stringify(fragment)} in ${JSON.stringify(result.errors)}`);
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

test("all current owner OpenAPI 3.1 documents parse with their admitted operations", () => {
  for (const owner of ["identity", "dsh", "wlt"]) {
    const result = validate(owner);
    assert.deepEqual(result.errors, [], `${owner} has invalid OpenAPI`);
  }
  assert.equal(validate("wlt").operations, 1);
  assert.ok(validate("identity").operations > 0);
  assert.ok(validate("dsh").operations > 0);
});

test("reject duplicate YAML mapping keys instead of silently accepting the last value", () => {
  const result = mutate("identity", "identity.openapi.yaml", (s) => `openapi: 3.1.0\n${s}`);
  assert.ok(result.errors.length > 0);
});

test("reject missing referenced modules", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace("./paths/stores.yaml#/paths/", "./paths/does-not-exist.yaml#/paths/"));
  hasError(result, "missing $ref file");
});

test("reject duplicate operationId across path fragments", () => {
  const result = mutate("dsh", "paths/offers.yaml", (s) =>
    s.replace("operationId: listPublicOffers", "operationId: listPublicStores"));
  hasError(result, "Duplicate operationId");
});

test("reject undeclared authorization schemes", () => {
  const result = mutate("identity", "paths/session.yaml", (s) =>
    s.replace("- OpaqueSession: []", "- NotRegistered: []"));
  hasError(result, "Unknown security scheme");
});

test("owner OpenAPI security schemes cannot downgrade opaque bearer authentication", () => {
  for (const owner of ["identity", "dsh"]) {
    const entry = owner + ".openapi.yaml";
    const result = mutate(owner, entry, (source) =>
      source.replace("type: http\n      scheme: bearer", "type: apiKey\n      name: X-Forged-Actor\n      in: header"));
    hasError(result, "OpaqueSession must be HTTP bearer");
    const basic = mutate(owner, entry, (source) =>
      source.replace("type: http\n      scheme: bearer", "type: http\n      scheme: basic"));
    hasError(basic, "OpaqueSession must be HTTP bearer");
  }
});

test("OpenAPI 3.0 downgrade is rejected instead of silently accepted as 3.1", () => {
  const result = mutate("identity", "identity.openapi.yaml", (source) =>
    source.replace("openapi: 3.1.0", "openapi: 3.0.3"));
  hasError(result, "OpenAPI 3.1");
});

test("owner OpenAPI entrypoints cannot inline a PathItem outside a fragment", () => {
  const result = mutate("identity", "identity.openapi.yaml", (source) =>
    source.replace("$ref: './paths/runtime.yaml#/paths/~1health'",
      "get:\n      operationId: inlineHealth\n      security: []\n      responses:\n        '204':\n          description: Inline"));
  hasError(result, "Owner PathItem must reference path module");
});

test("owner OpenAPI entrypoints cannot hide a sibling operation beside a PathItem reference", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (source) =>
    source.replace("$ref: './paths/runtime.yaml#/paths/~1health'",
      "$ref: './paths/runtime.yaml#/paths/~1health'\n    post: {}"));
  hasError(result, "Unsupported PathItem reference sibling");
});

test("owner PathItem references permit OpenAPI 3.1 summary and description metadata", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (source) =>
    source.replace("$ref: './paths/runtime.yaml#/paths/~1health'",
      "$ref: './paths/runtime.yaml#/paths/~1health'\n    summary: Health endpoint\n    description: No business operation"));
  assert.deepEqual(result.errors, [], "PathItem reference metadata must not be rejected");
});

test("reject missing required URI path parameter", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace("name: id", "name: mismatch"));
  hasError(result, "Missing required path parameter");
});

test("reject equivalent URI templates before choosing either operation", () => {
  const result = mutateOwnerFiles("dsh", {
    "dsh.openapi.yaml": (source) => source.replace("  /v1/public/stores/{id}:",
      "  /v1/public/stores/{storeId}:\n    $ref: './paths/stores.yaml#/paths/~1v1~1public~1stores~1{storeId}'\n  /v1/public/stores/{id}:"),
    "paths/stores.yaml": (source) => source.replace("  /v1/public/stores/{id}:",
      "  /v1/public/stores/{storeId}:\n    get:\n      operationId: readOtherStore\n      security: [{ OpaqueSession: [] }]\n      parameters: [{ name: storeId, in: path, required: true, schema: { type: string } }]\n      responses: { '204': { description: No body }, '401': { description: Denied } }\n  /v1/public/stores/{id}:"),
  });
  hasError(result, "Equivalent OpenAPI path templates");
});

test("reject response references that do not resolve to a Response Object", () => {
  const result = mutate("dsh", "paths/store-access.yaml", (source) =>
    source.replace(/('401':\n\s+\$ref: ).*/, "$1'../dsh.openapi.yaml#/components/schemas/StorePage'"));
  hasError(result, "Missing response description");
});

test("reject malformed parameter lists and undeclared path parameters without throwing", () => {
  const malformed = mutate("dsh", "paths/stores.yaml", (source) =>
    source.replace("parameters:\n", "parameters:\n        - null\n"));
  hasError(malformed, "Invalid OpenAPI object");
  const unused = mutate("dsh", "paths/stores.yaml", (source) =>
    source.replace("parameters:\n", "parameters:\n        - { name: extra, in: path, required: true, schema: { type: string } }\n"));
  hasError(unused, "Undeclared path parameter");
});

test("reject empty HTTP response headers instead of validating only the status code", () => {
  const result = mutate("dsh", "paths/store-access.yaml", (source) =>
    source.replace(/Cache-Control:\n\s+schema:.*/, "Cache-Control: {}"));
  hasError(result, "Missing response header schema or content");
});

test("reject a PathItem fragment that is not linked from the owner entrypoint", () => {
  const result = mutate("dsh", "paths/stores.yaml", (s) =>
    s.replace("  /v1/public/stores:\n", "  /v1/test/unlinked:\n"));
  assert.ok(result.errors.length > 0);
});

test("reject a newly added DSH OpenAPI path module that the entrypoint does not reference", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-unlinked-openapi-"));
  try {
    const contracts = path.join("services", "dsh", "contracts", "openapi");
    cpSync(path.join(root, contracts), path.join(tmp, contracts), { recursive: true });
    writeFileSync(path.join(tmp, contracts, "paths", "new-unlinked.yaml"),
      "paths:\n  /v1/test/unlinked:\n    get:\n      operationId: unlinkedTest\n      security: []\n      responses:\n        '200':\n          description: Test\n");
    const result = validate("dsh", tmp);
    hasError(result, "Unlinked path in");
    hasError(result, "Unreferenced path module");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("reject external schema URI references instead of resolving arbitrary network locations", () => {
  const result = mutate("dsh", "paths/stores.yaml", (source) =>
    source.replace("../dsh.openapi.yaml#/components/schemas/StorePage",
      "https://external.invalid/StorePage"));
  hasError(result, "unsupported $ref");
});

test("reject an unknown PathItem field even alongside a valid operation", () => {
  const result = mutate("dsh", "paths/stores.yaml", (s) =>
    s.replace("    get:\n      operationId: listPublicStores",
      "    fetch: {}\n    get:\n      operationId: listPublicStores"));
  hasError(result, "Unknown PathItem field");
});

test("reject non-HTTP response status names", () => {
  const result = mutate("dsh", "paths/stores.yaml", (s) =>
    s.replace("        '200':", "        success:"));
  hasError(result, "Invalid HTTP response status");
});

test("reject JSON pointers that resolve only through the JavaScript prototype chain", () => {
  const result = mutate("dsh", "paths/stores.yaml", (s) =>
    s.replace("../dsh.openapi.yaml#/components/schemas/StorePage",
      "../dsh.openapi.yaml#/__proto__"));
  hasError(result, "unresolved $ref");
});

test("reject a PathItem reference to a different path in the same YAML module", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace(
      "'./paths/stores.yaml#/paths/~1v1~1public~1stores'",
      "'./paths/stores.yaml#/paths/~1v1~1public~1stores~1{id}'",
    ));
  hasError(result, "PathItem reference does not match declared path");
});

test("reject operation with missing explicit security declaration", () => {
  const result = mutate("identity", "paths/session.yaml", (s) =>
    s.replace("security:", "security_removed:"));
  hasError(result, "Missing explicit operation security");
});

test("reject non-array operation security without throwing", () => {
  const result = mutate("identity", "paths/session.yaml", (s) =>
    s.replace("- OpaqueSession: []", "NotRegistered"));
  hasError(result, "Invalid operation security");
});

test("reject malformed PathItem reference without throwing", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace(
      "    $ref: './paths/stores.yaml#/paths/~1v1~1public~1stores'",
      "    $ref: { unexpected: path }",
    ));
  hasError(result, "Invalid PathItem $ref");
});

// These tests exercise the hand-written public client against the *owner's*
// OpenAPI 3.1 contract, not a generated-client file that does not exist.
test("DSH public Store/Vertical/Offer client requests match owner OpenAPI operation paths and methods", async () => {
  const contractDir = path.join(root, "services", "dsh", "contracts", "openapi");
  const entrypoint = (await import("yaml")).default.parse(
    readFileSync(path.join(contractDir, "dsh.openapi.yaml"), "utf8"),
  );
  const { listPublicStores, listPublicVerticals, getPublicStore, listPublicOffers } =
    await import("../../services/dsh/clients/index.ts");
  const responseStore = {
    id: "market-sanaa", name: "سوق", cityId: "sanaa", verticalId: "grocery",
    orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
  };
  const responseVertical = { id: "grocery", storeCount: 2 };
  const responseOffer = {
    id: "offer-one", storeId: "market-sanaa", name: "دقيق",
    variantId: "variant-one", priceYer: 1200, available: true,
  };
  const cases = [
    ["listPublicVerticals", "/v1/public/verticals", () => listPublicVerticals("http://127.0.0.1:3202", "sanaa"),
      { items: [responseVertical], revision: 1 }],
    ["listPublicStores", "/v1/public/stores", () => listPublicStores("http://127.0.0.1:3202", "sanaa"),
      { items: [responseStore], revision: 1 }],
    ["getPublicStore", "/v1/public/stores/{id}", () => getPublicStore("http://127.0.0.1:3202", "market-sanaa"),
      responseStore],
    ["listPublicOffers", "/v1/public/stores/{id}/offers", () => listPublicOffers("http://127.0.0.1:3202", "market-sanaa"),
      { items: [responseOffer], revision: 1 }],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [operationId, publicPath, call, payload] of cases) {
      const [fragmentFile, pointer] = entrypoint.paths[publicPath].$ref.split("#");
      const fragment = (await import("yaml")).default.parse(
        readFileSync(path.resolve(contractDir, fragmentFile), "utf8"),
      );
      const pathItem = pointer.slice(1).split("/").filter(Boolean).reduce(
        (node, key) => node[key.replaceAll("~1", "/").replaceAll("~0", "~")], fragment,
      );
      assert.equal(pathItem.get.operationId, operationId);
      assert.deepEqual(pathItem.get.security, [], "Public reads must stay unauthenticated");
      assert.deepEqual(Object.keys(pathItem), ["get"], "Unexpected public mutation");
      let captured;
      globalThis.fetch = async (request, options) => {
        captured = { url: new URL(request), options };
        return jsonResponse(payload);
      };
      await call();
      assert.equal(captured.url.pathname, publicPath.replace("{id}", "market-sanaa"));
      assert.equal(captured.options.method ?? "GET", "GET");
      assert.equal(captured.options.credentials, "omit");
      assert.equal(captured.options.redirect, "error");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DSH public client rejects Store, Vertical, Offer and page shapes forbidden by OpenAPI", async () => {
  const { listPublicStores, listPublicVerticals, listPublicOffers, DshPublicError } =
    await import("../../services/dsh/clients/index.ts");
  const sourceStore = {
    id: "market-sanaa", name: "متجر", cityId: "sanaa", verticalId: "grocery",
    orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
  };
  const sourceOffer = {
    id: "offer-one", storeId: sourceStore.id, name: "دقيق",
    variantId: "variant-one", priceYer: 1200, available: true,
  };
  const badStores = [
    { ...sourceStore, id: "../operator" },
    { ...sourceStore, name: "" },
    { ...sourceStore, name: "x".repeat(121) },
    { ...sourceStore, verticalId: "private store" },
    { ...sourceStore, privateMerchantEmail: "do-not-expose@example.invalid" },
  ];
  const badVerticals = [
    { id: "UPPER", storeCount: 1 },
    { id: "grocery", storeCount: 0 },
    { id: "grocery", storeCount: -1 },
    { id: "grocery", storeCount: 1.5 },
    { id: "grocery", storeCount: Number.MAX_SAFE_INTEGER + 1 },
    { id: "grocery", storeCount: 2, ownerActorId: "private" },
  ];
  const badOffers = [
    { ...sourceOffer, id: "BAD_UPPERCASE" },
    { ...sourceOffer, variantId: "" },
    { ...sourceOffer, name: "" },
    { ...sourceOffer, name: "x".repeat(161) },
    { ...sourceOffer, internalCostYer: 100 },
  ];
  const originalFetch = globalThis.fetch;
  const expectRejected = async (call, body) => {
    globalThis.fetch = async () => jsonResponse(body);
    await assert.rejects(call, error => error instanceof DshPublicError &&
      error.status === 502 && error.code === "OWNER_RESPONSE_INVALID");
  };
  try {
    for (const store of badStores) {
      await expectRejected(() => listPublicStores("http://127.0.0.1:3202", "sanaa"),
        { items: [store], revision: 1 });
    }
    for (const vertical of badVerticals) {
      await expectRejected(() => listPublicVerticals("http://127.0.0.1:3202", "sanaa"),
        { items: [vertical], revision: 1 });
    }
    for (const offer of badOffers) {
      await expectRejected(() => listPublicOffers("http://127.0.0.1:3202", "market-sanaa"),
        { items: [offer], revision: 1 });
    }
    for (const page of [
      { items: [sourceStore], revision: -1 },
      { items: [sourceStore], revision: 1, nextCursor: "x".repeat(513) },
      { items: [sourceStore], revision: 1, internalAudit: "not-public" },
    ]) {
      await expectRejected(() => listPublicStores("http://127.0.0.1:3202", "sanaa"), page);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("public DSH discovery uses an uncredentialed no-redirect GET at the owner boundary", async () => {
  const { getPublicStore } = await import("../../services/dsh/clients/index.ts");
  const originalFetch = globalThis.fetch;
  let captured;
  try {
    globalThis.fetch = async (_url, options) => {
      captured = options;
      return jsonResponse({
        id: "market-sanaa", name: "متجر", cityId: "sanaa", verticalId: "grocery",
        orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
      });
    };
    await getPublicStore("http://127.0.0.1:3202", "market-sanaa");
    assert.equal(captured.method ?? "GET", "GET");
    assert.equal(captured.credentials, "omit", "discovery must not attach caller cookies");
    assert.equal(captured.redirect, "error", "owner reads cannot follow a cross-origin redirect");
    assert.equal(captured.cache, "no-store", "readback must not inherit another account's cached response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public DSH Store, Vertical and Offer client validators track declared OpenAPI field bounds", async () => {
  const contractDir = path.join(root, "services", "dsh", "contracts", "openapi");
  const YAML = (await import("yaml")).default;
  const schema = YAML.parse(readFileSync(path.join(contractDir, "dsh.openapi.yaml"), "utf8")).components.schemas;
  const { listPublicStores, listPublicOffers, DshPublicError } =
    await import("../../services/dsh/clients/index.ts");
  assert.equal(schema.PublicStore.additionalProperties, false);
  assert.equal(schema.PublicVertical.additionalProperties, false);
  assert.equal(schema.VerticalPage.additionalProperties, false);
  assert.equal(schema.PublicVertical.properties.storeCount.minimum, 1);
  assert.equal(schema.PublicVertical.properties.storeCount.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.VerticalPage.properties.items.maxItems, 50);
  assert.equal(schema.StorePage.properties.items.maxItems, 50);
  assert.equal(schema.OfferPage.properties.items.maxItems, 50);
  assert.equal(schema.PublicOffer.additionalProperties, false);
  assert.equal(schema.PublicId.pattern, "^[a-z0-9-]{1,64}$");
  assert.equal(schema.PublicStore.properties.name.maxLength, 120);
  assert.equal(schema.PublicOffer.properties.name.maxLength, 160);
  assert.equal(schema.PublicStore.properties.orderingAvailable.const, false);
  assert.equal(schema.PublicOffer.properties.available.const, true);
  const base = "http://127.0.0.1:3202";
  const store = {
    id: "market-sanaa", name: "x", cityId: "sanaa", verticalId: "grocery",
    orderabilityStatus: "OPERATIONALLY_UNAVAILABLE", orderingAvailable: false,
  };
  const offer = {
    id: "offer-one", storeId: "market-sanaa", name: "x", variantId: "variant-one",
    priceYer: 1, available: true,
  };
  const originalFetch = globalThis.fetch;
  try {
    for (const [validObject, source, length, call] of [
      [store, "PublicStore", schema.PublicStore.properties.name.maxLength,
        () => listPublicStores(base, "sanaa")],
      [offer, "PublicOffer", schema.PublicOffer.properties.name.maxLength,
        () => listPublicOffers(base, "market-sanaa")],
    ]) {
      const page = (value) => ({ items: [value], revision: 0 });
      globalThis.fetch = async () => jsonResponse(page({
        ...validObject, name: "x".repeat(length),
      }));
      assert.equal((await call()).items.length, 1, source + " accepts maximum name");
      globalThis.fetch = async () => jsonResponse(page({
        ...validObject, name: "x".repeat(length + 1),
      }));
      await assert.rejects(call, error => error instanceof DshPublicError &&
        error.status === 502 && error.code === "OWNER_RESPONSE_INVALID", source + " rejects excessive name");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DSH Store owner unavailability error is admitted by its documented response schema", async () => {
  const YAML = (await import("yaml")).default;
  const source = readFileSync(path.join(root, "services/dsh/contracts/openapi/dsh.openapi.yaml"), "utf8");
  const schema = YAML.parse(source).components.schemas.StoreOperationalError;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["code"]);
  assert.ok(schema.properties.code.enum.includes("STORE_OWNER_UNAVAILABLE"),
    "the 503 emitted by the Store listing handler must be contract-valid");
});

test("Captain DSH owner SDK exports match four authenticated OpenAPI operations and preserve write uncertainty", async () => {
  const YAML = (await import("yaml")).default;
  const base = "http://127.0.0.1:3202";
  const actor = "captain-verified";
  const bearer = "A".repeat(43);
  const contractDir = path.join(root, "services", "dsh", "contracts", "openapi");
  const entry = YAML.parse(readFileSync(path.join(contractDir, "dsh.openapi.yaml"), "utf8"));
  const {
    readApprovedCaptainStanding, readCaptainApplication, requestCaptainApplication,
  } = await import("../../services/dsh/clients/index.ts");
  const approved = { actorId: actor, status: "APPROVED", version: 2 };
  const pending = { actorId: actor, status: "PENDING", version: 1 };
  const cases = [
    ["getCurrentCaptainStanding", "get", "/v1/captains/me/standing",
      () => readApprovedCaptainStanding(base, bearer, "captain", actor), approved],
    ["getCurrentCustomerCaptainEligibility", "get", "/v1/actors/me/captain-eligibility",
      () => readApprovedCaptainStanding(base, bearer, "customer", actor), approved],
    ["getCurrentCustomerCaptainApplication", "get", "/v1/actors/me/captain-application",
      () => readCaptainApplication(base, bearer, actor), pending],
    ["applyCurrentCustomerForCaptainStanding", "post", "/v1/actors/me/captain-application",
      () => requestCaptainApplication(base, bearer, actor), pending],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [operationId, method, route, call, result] of cases) {
      const [fragmentPath, pointer] = entry.paths[route].$ref.split("#");
      const fragment = YAML.parse(readFileSync(path.resolve(contractDir, fragmentPath), "utf8"));
      const pathItem = pointer.slice(1).split("/").filter(Boolean).reduce(
        (node, key) => node[key.replaceAll("~1", "/").replaceAll("~0", "~")], fragment,
      );
      assert.equal(pathItem[method].operationId, operationId, "owner operationId drift");
      assert.deepEqual(pathItem[method].security, [{ OpaqueSession: [] }], "owner auth scope drift");
      assert.ok(pathItem[method].responses["200"], "expected owner readback/commit response");
      let captured;
      globalThis.fetch = async (url, options) => {
        captured = { url: new URL(url), options };
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      };
      await call();
      assert.equal(captured.url.pathname, route);
      assert.equal(captured.options.method, method.toUpperCase());
      assert.equal(captured.options.headers.Authorization, `Bearer ${bearer}`);
      assert.equal(captured.options.headers.Accept, "application/json");
      assert.equal(captured.options.redirect, "error");
      assert.equal(captured.options.credentials, "omit");
      assert.equal(captured.options.cache, "no-store");
      assert.equal(captured.options.body, undefined, "application uses DSH-authenticated bearer only");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  const appBridge = readFileSync(path.join(root, "apps", "captain", "src", "features", "access", "captain-standing.ts"), "utf8");
  assert.match(appBridge, /from "@bthwani\/dsh"/, "Captain must consume public DSH owner export");
  assert.doesNotMatch(appBridge, /\bfetch\s*\(/, "Captain must not maintain an independent owner transport");
});


test("remaining DSH authenticated client requests match owner OpenAPI operations", async () => {
  const YAML = (await import("yaml")).default;
  const contractDir = path.join(root, "services", "dsh", "contracts", "openapi");
  const entry = YAML.parse(readFileSync(path.join(contractDir, "dsh.openapi.yaml"), "utf8"));
  const client = await import("../../services/dsh/clients/index.ts");
  const base = "http://127.0.0.1:3202";
  const bearer = "A".repeat(43);
  const storeID = "market-sanaa";
  const cityID = "sanaa";
  const actorID = "captain-review";
  const availabilityChange = {
    operationId: "store-availability-001", expectedVersion: 1,
    weekly: [], preparationMinutes: 5, reason: "owner-review",
  };
  const cityChange = {
    operationId: "city-policy-001", expectedVersion: 1,
    maxPauseSeconds: 600, maxPreparationMinutes: 60, reason: "owner-review",
  };
  const captainChange = {
    operationId: "captain-review-001", expectedVersion: 1,
    status: "APPROVED", reason: "owner-review",
  };
  const cases = [
    ["listCurrentMerchantStores", "GET", "/v1/stores/mine",
      () => client.readMerchantDSHStanding(base, bearer)],
    ["getStoreOperationalAvailability", "GET", "/v1/stores/{storeID}/availability",
      () => client.getStoreOperationalAvailability(base, storeID, bearer)],
    ["updateStoreOperationalAvailability", "PATCH", "/v1/stores/{storeID}/availability",
      () => client.updateStoreOperationalAvailability(base, storeID, bearer, availabilityChange), availabilityChange],
    ["getCityStoreOperationalPolicy", "GET", "/v1/operators/cities/{cityID}/store-availability-policy",
      () => client.getCityStoreOperationalPolicy(base, cityID, bearer)],
    ["replaceCityStoreOperationalPolicy", "PATCH", "/v1/operators/cities/{cityID}/store-availability-policy",
      () => client.replaceCityStoreOperationalPolicy(base, cityID, bearer, cityChange), cityChange],
    ["listOperatorCaptainStandings", "GET", "/v1/operators/captains",
      () => client.listOperatorCaptainStandings(base, bearer)],
    ["getOperatorCaptainStanding", "GET", "/v1/operators/captains/{actorId}/standing",
      () => client.getOperatorCaptainStanding(base, actorID, bearer)],
    ["changeCaptainStandingByAuthorizedOperator", "PATCH", "/v1/operators/captains/{actorId}/standing",
      () => client.changeOperatorCaptainStanding(base, actorID, bearer, captainChange), captainChange],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [operationId, method, template, invoke, change] of cases) {
      const ref = entry.paths[template]?.$ref;
      assert.equal(typeof ref, "string", operationId + " must be linked by the owner entrypoint");
      const [fragmentPath, pointer] = ref.split("#");
      const fragment = YAML.parse(readFileSync(path.resolve(contractDir, fragmentPath), "utf8"));
      const operation = pointer.slice(1).split("/").filter(Boolean).reduce((node, key) =>
        node[key.replaceAll("~1", "/").replaceAll("~0", "~")], fragment)[method.toLowerCase()];
      assert.equal(operation.operationId, operationId);
      assert.deepEqual(operation.security, [{ OpaqueSession: [] }]);
      assert.ok(operation.responses["200"], operationId + " needs an owner readback response");
      if (change) assert.equal(operation.requestBody?.required, true, operationId + " needs a body");
      let captured;
      globalThis.fetch = async (url, options) => {
        captured = { url: new URL(url), options };
        return new Response(JSON.stringify({ code: "CONFLICT" }), {
          status: 409,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      };
      await assert.rejects(invoke, operationId + " must reject a controlled 409");
      assert.ok(captured, operationId + " must actually use owner HTTP");
      const expectedPath = template
        .replace("{storeID}", storeID).replace("{cityID}", cityID).replace("{actorId}", actorID);
      assert.equal(captured.url.pathname, expectedPath);
      assert.equal(captured.options.method, method);
      assert.equal(captured.options.headers.Authorization, "Bearer " + bearer);
      assert.equal(captured.options.headers.Accept, "application/json");
      assert.equal(captured.options.redirect, "error");
      assert.equal(captured.options.credentials, "omit");
      assert.equal(captured.options.cache, "no-store");
      if (change) {
        assert.deepEqual(JSON.parse(captured.options.body), change);
        assert.equal(captured.options.headers["Content-Type"], "application/json");
      } else {
        assert.equal(captured.options.body, undefined);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("a repurposed public health operation cannot inherit anonymous access", () => {
  const result = mutate("dsh", "paths/runtime.yaml", source =>
    source.replace("operationId: dshHealth", "operationId: readPrivateOwnerState"));
  hasError(result, "Protected operation must require OpaqueSession");
});

test("repurposing an existing public DSH path requires explicit operation identity admission", () => {
  const result = mutate("dsh", "paths/stores.yaml", source =>
    source.replace("operationId: listPublicStores", "operationId: listPrivateAccountBalances"));
  hasError(result, "Protected operation must require OpaqueSession");
});

test("repurposing an existing public Identity path cannot inherit anonymous permission", () => {
  const result = mutate("identity", "paths/client-auth.yaml", source =>
    source.replace("operationId: issueCustomerPhoneChallenge", "operationId: issueOperatorRootSession"));
  hasError(result, "Protected operation must require OpaqueSession");
});

test("new DSH public-prefixed endpoint is protected until explicitly admitted", () => {
  const result = mutateOwnerFiles("dsh", {
    "dsh.openapi.yaml": source => source.replace(
      "/v1/public/stores:\n    $ref: './paths/stores.yaml#/paths/~1v1~1public~1stores'",
      "/v1/public/actor-private:\n    $ref: './paths/stores.yaml#/paths/~1v1~1public~1actor-private'",
    ),
    "paths/stores.yaml": source => source.replace(
      "  /v1/public/stores:\n", "  /v1/public/actor-private:\n",
    ),
  });
  hasError(result, "Protected operation must require OpaqueSession");
});

test("new Identity customer-auth-prefixed endpoint is protected until explicitly admitted", () => {
  const result = mutateOwnerFiles("identity", {
    "identity.openapi.yaml": source => source.replace(
      "/v1/customer-auth/phone-challenges:\n    $ref: './paths/client-auth.yaml#/paths/~1v1~1customer-auth~1phone-challenges'",
      "/v1/customer-auth/admin-reset:\n    $ref: './paths/client-auth.yaml#/paths/~1v1~1customer-auth~1admin-reset'",
    ),
    "paths/client-auth.yaml": source => source.replace(
      "  /v1/customer-auth/phone-challenges:\n", "  /v1/customer-auth/admin-reset:\n",
    ),
  });
  hasError(result, "Protected operation must require OpaqueSession");
});

test("owner contract cannot anonymously downgrade protected routes", () => {
  for (const [owner, fragment] of [
    ["identity", "paths/session.yaml"],
    ["dsh", "paths/store-access.yaml"],
  ]) {
    const result = mutate(owner, fragment, source =>
      source.replace("security:\n        - OpaqueSession: []", "security: []"));
    hasError(result, "Protected operation must require OpaqueSession");
  }
});

test("owner contract cannot unexpectedly require credentials for public discovery", () => {
  const result = mutate("dsh", "paths/stores.yaml", source =>
    source.replace("security: []", "security:\n        - OpaqueSession: []"));
  hasError(result, "Public operation must not require OpaqueSession");
});

test("owner contract refuses operations without successful responses", () => {
  const result = mutate("dsh", "paths/stores.yaml", source =>
    source.replace("'200':\n          description: Bounded public vertical identity",
      "'418':\n          description: Bounded public vertical identity"));
  hasError(result, "No successful response");
});

test("owner contract refuses a successful JSON response with no schema", () => {
  const result = mutate("dsh", "paths/stores.yaml", source =>
    source.replace("schema: { $ref: '../dsh.openapi.yaml#/components/schemas/StorePage' }",
      "example: { items: [] }"));
  hasError(result, "Missing successful JSON response schema");
});


test("owner contract cannot drop explicit 401 denial for protected reads", () => {
  for (const [owner, fragment] of [
    ["identity", "paths/session.yaml"],
    ["dsh", "paths/store-access.yaml"],
  ]) {
    const result = mutate(owner, fragment, source =>
      source.replace("        '401':", "        '402':"));
    hasError(result, "Protected operation missing 401 response");
  }
});
