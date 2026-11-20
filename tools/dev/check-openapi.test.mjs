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

function hasError(result, fragment) {
  assert.ok(result.errors.some((error) => error.includes(fragment)),
    `Expected ${JSON.stringify(fragment)} in ${JSON.stringify(result.errors)}`);
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

test("all current owner OpenAPI 3.1 documents parse; unimplemented WLT stays explicitly empty", () => {
  for (const owner of ["identity", "dsh", "wlt"]) {
    const result = validate(owner);
    assert.deepEqual(result.errors, [], `${owner} has invalid OpenAPI`);
  }
  assert.equal(validate("wlt").operations, 0);
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

test("reject missing required URI path parameter", () => {
  const result = mutate("dsh", "dsh.openapi.yaml", (s) =>
    s.replace("name: id", "name: mismatch"));
  hasError(result, "Missing required path parameter");
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
