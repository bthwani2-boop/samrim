import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { firstStoreModesForRelation } from "../src/features/partner-onboarding/first-store-relation-choice.ts";

const source = readFileSync(new URL("../app/setup.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let productionSave;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "save") productionSave = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(productionSave, "exercise the real setup save handler");
const code = ts.transpileModule(productionSave.getText(ast) + "; save;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const matchingStore = (id = "store-1") => ({
  id, owned: true, name: "محل تجريبي", relationModel: "INDEPENDENT_STORE",
  serviceCityId: "city-1", primaryVerticalId: "vertical-1",
  fulfillmentModes: ["CUSTOMER_PICKUP"],
});

function harness({ create, read, modes = ["CUSTOMER_PICKUP"], additional = false } = {}) {
  const events = { created: 0, read: 0, keys: [], saved: [], recovered: [], errors: [], busy: [], cleared: 0 };
  let activeSession = "partner-a:session-1";
  const setSession = value => { activeSession = value; };
  const client = {
    async createPartnerFirstStore(_token, _input, key) {
      events.created++;
      events.keys.push(key);
      return create ? create() : { storeId: "store-1", relationModel: "INDEPENDENT_STORE" };
    },
    async createPartnerAdditionalStore(_token, _input, key) {
      events.created++;
      events.keys.push(key);
      return create ? create() : { storeId: "store-1", relationModel: "INDEPENDENT_STORE" };
    },
    async listPartnerAccessibleStores() {
      events.read++;
      return read ? read() : { stores: [matchingStore()] };
    },
  };
  const environment = {
    busy: false, saveInFlight: { current: false },
    scope: "partner-a:session-1",
    draftScope: additional ? "partner-a:session-1:additional" : "partner-a:session-1",
    additional,
    selected: { latitude: 15.3, longitude: 44.2 },
    name: "محل تجريبي", relation: "INDEPENDENT_STORE", city: "city-1",
    vertical: "vertical-1", storeType: "type-1", address: "عنوان تجريبي",
    modes, registryReady: true, joiningPolicies: [],
    typesLoading: false, typesError: false, types: [{ id: "type-1", verticalId: "vertical-1" }],
    cities: [{ id: "city-1" }], verticals: [{ id: "vertical-1", active: true }],
    firstStoreRelationCanEnroll: () => true,
    firstStoreModesForRelation,
    getUsableIdentityAccessToken: async () => "valid-token",
    currentIdentityState: () => activeSession,
    partnerSetupSessionKey: identity => identity,
    service: () => client,
    clearPartnerSetupDraft: () => { events.cleared++; },
    setBusy: value => events.busy.push(value),
    setError: value => events.errors.push(value),
    setSaved: value => events.saved.push(value),
    setRecovered: value => events.recovered.push(value),
    setStep: () => {},
    errorText: cause => cause?.message || "تعذّر الإنشاء",
    Error,
    Crypto: { CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async (_algorithm, value) => createHash("sha256").update(value).digest("hex") },
  };
  return { save: runInNewContext(code, environment), events, setSession };
}

test("lost create response recovers existing owned DSH Store, with no second POST on same-tick taps", async () => {
  const h = harness({
    create: async () => { throw { kind: "network", message: "network response lost after commit" }; },
    read: async () => ({ stores: [matchingStore("owned-store")] }),
  });
  const first = h.save();
  const duplicate = h.save();
  await Promise.all([first, duplicate]);
  assert.equal(h.events.created, 1, "synchronous duplicate-tap lock");
  assert.equal(h.events.read, 1, "canonical owner readback after ambiguous response");
  assert.deepEqual(h.events.saved, ["owned-store"]);
  assert.deepEqual(h.events.recovered, [true]);
  assert.equal(h.events.cleared, 0, "an ambiguous response cannot erase the form draft");
  assert.equal(h.events.errors.filter(Boolean).length, 0);
  assert.equal(h.events.busy.at(-1), false);
});

test("same-session manual retry reuses the exact first Store idempotency key", async () => {
  const h = harness({
    create: async () => { throw { kind: "network", message: "lost response" }; },
    read: async () => ({ stores: [] }),
  });
  await h.save();
  await h.save();
  assert.equal(h.events.created, 2);
  assert.equal(h.events.keys[0], h.events.keys[1], "exact submission has a stable key");
  assert.match(h.events.keys[0], /^first_store_[0-9a-f]{64}$/);
  assert.equal(h.events.cleared, 0);
});

test("failed create never trusts another actor's inaccessible Store or fabricates success", async () => {
  const h = harness({
    create: async () => { throw { kind: "network", message: "network down" }; },
    read: async () => ({ stores: [{ ...matchingStore("not-owned"), owned: false }] }),
  });
  await h.save();
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.cleared, 0);
  assert.match(h.events.errors.at(-1), /network down/);
});

test("Identity switch before ambiguous create response blocks any old-owner recovery GET", async () => {
  let rejectRequest;
  const h = harness({ create: () => new Promise((_resolve, reject) => { rejectRequest = reject; }) });
  const pending = h.save();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof rejectRequest, "function", "request must be in flight before changing the session");
  h.setSession("partner-b:session-2");
  rejectRequest({ kind: "network", message: "response lost" });
  await pending;
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.read, 0);
  assert.equal(h.events.errors.filter(Boolean).length, 0);
  assert.equal(h.events.cleared, 0);
});

test("normal owner-confirmed first Store creation remains unchanged", async () => {
  const h = harness();
  await h.save();
  assert.equal(h.events.created, 1);
  assert.equal(h.events.read, 1);
  assert.deepEqual(h.events.saved, ["store-1"]);
  assert.deepEqual(h.events.recovered, [false]);
  assert.equal(h.events.cleared, 1);
});

test("unrelated owned Store is not mistaken for newly attempted creation", async () => {
  const h = harness({
    create: async () => { throw { kind: "network", message: "request timeout" }; },
    read: async () => ({ stores: [{ ...matchingStore("previous"), name: "متجر آخر", relationModel: "BTHWANI_PARTNER" }] }),
  });
  await h.save();
  assert.equal(h.events.read, 1);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.cleared, 0);
  assert.match(h.events.errors.at(-1), /request timeout/);
});

test("definitive 409 response never attempts recovery or adopts an existing Store", async () => {
  const h = harness({
    create: async () => { throw { kind: "http", status: 409, code: "CONFLICT", message: "definitive conflict" }; },
    read: async () => ({ stores: [matchingStore("previous")] }),
  });
  await h.save();
  assert.equal(h.events.read, 0);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.cleared, 0);
  assert.match(h.events.errors.at(-1), /definitive conflict/);
});

test("HTTP 503 may inspect a matching owned Store but cannot clear the draft", async () => {
  const h = harness({
    create: async () => { throw { kind: "http", status: 503, code: "UNAVAILABLE", message: "unknown result" }; },
    read: async () => ({ stores: [matchingStore("possible")] }),
  });
  await h.save();
  assert.equal(h.events.read, 1);
  assert.deepEqual(h.events.saved, ["possible"]);
  assert.deepEqual(h.events.recovered, [true]);
  assert.equal(h.events.cleared, 0);
});

test("a confirmed POST whose owner readback fails is not a second ambiguous create", async () => {
  const h = harness({ read: async () => { throw { kind: "network", message: "read unavailable" }; } });
  await h.save();
  assert.equal(h.events.created, 1);
  assert.equal(h.events.read, 1, "a failed follow-on read must not trigger speculative replay lookup");
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.cleared, 0);
});


test("restored independent draft cannot submit stale marketplace Captain to DSH", async () => {
  const h = harness({ modes: ["CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"] });
  await h.save();
  assert.equal(h.events.created, 0, "invalid independent fulfillment must stop before the POST");
  assert.equal(h.events.read, 0);
  assert.match(h.events.errors.at(-1), /طريقة التوصيل|طرق التوصيل/);
});

test("the wizard sanitizes persisted Store modes using its canonical relation helper", () => {
  assert.match(source, /useState<StoreFulfillmentMode\[\]>\(\(\) => firstStoreModesForRelation\(/);
});


test("additional Store uses its own idempotency namespace without altering first Store replay", async () => {
  const additional = harness({ additional: true });
  await additional.save();
  assert.equal(additional.events.created, 1);
  assert.match(additional.events.keys[0], /^additional_store_[0-9a-f]{64}$/);
  assert.deepEqual(additional.events.saved, ["store-1"]);
  assert.equal(additional.events.cleared, 1);

  const first = harness();
  await first.save();
  assert.match(first.events.keys[0], /^first_store_[0-9a-f]{64}$/);
  assert.notEqual(first.events.keys[0], additional.events.keys[0]);
});

test("additional Store requires exact owned readback across bounded pages", async () => {
  let pageNumber = 0;
  const h = harness({
    additional: true,
    read: async () => {
      pageNumber++;
      return pageNumber === 1
        ? { stores: [matchingStore("unrelated")], nextCursor: "next-page" }
        : { stores: [matchingStore()], nextCursor: "" };
    },
  });
  await h.save();
  assert.equal(h.events.read, 2);
  assert.deepEqual(h.events.saved, ["store-1"]);
  assert.deepEqual(h.events.recovered, [false]);
});

test("additional Store does not accept unverified result without its exact ID", async () => {
  const h = harness({
    additional: true,
    read: async () => ({ stores: [matchingStore("another")] }),
  });
  await h.save();
  assert.equal(h.events.created, 1);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.events.cleared, 0);
  assert.match(h.events.errors.at(-1), /STORE_READBACK_MISMATCH/);
});

test("additional Store manual retry preserves exact request key and does not auto-resubmit", async () => {
  const h = harness({
    additional: true,
    create: async () => { throw { kind: "network", message: "response lost" }; },
    read: async () => ({ stores: [] }),
  });
  await h.save();
  assert.equal(h.events.created, 1);
  assert.equal(h.events.cleared, 0);
  await h.save();
  assert.equal(h.events.created, 2);
  assert.equal(h.events.keys[0], h.events.keys[1]);
  assert.match(h.events.keys[0], /^additional_store_/);
});
