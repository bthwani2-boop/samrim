import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./partner-order-availability.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("partner-order-availability.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let readInitializer;
let subscribeInitializer;
let resumeDeclaration;
let validateDeclaration;

function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "readAvailability") {
    readInitializer = node.initializer?.getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("subscribeIdentitySession")) {
    subscribeInitializer = node.arguments[0]?.getText(ast);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "resumeOrders") {
    resumeDeclaration = node.getText(ast);
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "isOwnStoreReadback") {
    validateDeclaration = node.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(readInitializer && subscribeInitializer && resumeDeclaration && validateDeclaration,
  "extract actual availability read, subscription, resume and Store validation from production");
const compile = body => ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const validate = vm.runInNewContext(`${compile(validateDeclaration)}\nisOwnStoreReadback`);
const run = (body, context) => vm.runInNewContext(compile(body), context);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const actor = (sessionId) => ({ kind: "authenticated", identity: { role: "partner", subject: "actor-a", sessionId } });
const scope = (state) => state.kind === "authenticated"
  ? JSON.stringify([state.identity.subject, state.identity.sessionId]) : "";
function availability(storeId = "store-a", paused = true, modeStoreId = storeId) {
  return {
    availability: {
      storeId, paused, version: 4, scheduleMode: "ALWAYS_OPEN", weeklySchedule: [],
      preparationMinutes: 12, unavailableFulfillmentModes: [], pauseUntil: null,
    },
    orderabilityByMode: [{ storeId: modeStoreId, state: paused ? "PAUSED" : "OPEN_FOR_ORDERS" }],
  };
}

test("DSH read accepts only correct Store availability and orderability rows", () => {
  assert.equal(validate(availability(), "store-a"), true);
  assert.equal(validate(availability("store-b"), "store-a"), false);
  assert.equal(validate(availability("store-a", true, "store-b"), "store-a"), false);
  assert.equal(validate({ availability: { storeId: "store-a" }, orderabilityByMode: null }, "store-a"), false);
});

test("same-actor replacement session discards late availability GET without displaying old status", async () => {
  const reply = deferred();
  const generation = { current: 0 };
  let current = true;
  const statuses = [];
  const errors = [];
  const callback = run(`const callback = ${readInitializer}; callback;`, {
    useCallback: fn => fn, busyRef: { current: false },
    stillCurrentSession: () => current, generation, storeID: "store-a",
    readOwnStoreOperationalAvailability: () => reply.promise,
    isOwnStoreReadback: validate,
    setStatus: value => statuses.push(value),
    setReadError: value => errors.push(value),
    setPending() {},
    Error,
  });
  const reading = callback();
  current = false;
  reply.resolve(availability());
  await reading;
  assert.deepEqual(statuses, []);
  assert.deepEqual(errors, []);
});

test("wrong-Store DSH readback is rejected and does not become an orderability badge", async () => {
  const generation = { current: 0 };
  const statuses = [];
  const errors = [];
  const callback = run(`const callback = ${readInitializer}; callback;`, {
    useCallback: fn => fn, busyRef: { current: false }, stillCurrentSession: () => true,
    generation, storeID: "store-a",
    readOwnStoreOperationalAvailability: async () => availability("store-b"),
    isOwnStoreReadback: validate,
    setStatus: value => statuses.push(typeof value === "function" ? value("loading") : value),
    setReadError: value => errors.push(value), setPending() {}, Error,
  });
  await callback();
  assert.deepEqual(statuses, ["error"]);
  assert.deepEqual(errors, [true]);
});

test("Identity subscription invalidates in-flight work, pending retry and visible status", () => {
  let listener;
  const previous = scope(actor("session-a"));
  const generation = { current: 3 };
  const busyRef = { current: true };
  const events = [];
  const subscribe = run(`const listenerEffect = ${subscribeInitializer}; listenerEffect;`, {
    subscribeIdentitySession: callback => { listener = callback; return () => {}; },
    partnerSetupSessionKey: scope, activeScope: { current: previous }, generation, busyRef,
    setStatus: value => events.push(["status", value]),
    setReadError: value => events.push(["error", value]),
    setBusy: value => events.push(["busy", value]),
    setError: value => events.push(["notice", value]),
    setPending: value => events.push(["pending", value]),
    setSessionScope: value => events.push(["scope", value]),
  });
  subscribe();
  listener(actor("session-b"));
  assert.equal(generation.current, 4);
  assert.equal(busyRef.current, false);
  assert.deepEqual(events.map(([kind]) => kind),
    ["status", "error", "busy", "notice", "pending", "scope"]);
  assert.equal(events.at(-1)[1], scope(actor("session-b")));
  assert.equal(events.find(([kind]) => kind === "pending")[1], null);
});

function resumeHarness() {
  const request = deferred();
  const events = [];
  const calls = [];
  const context = {
    storeID: "store-a", scopeCurrent: true, ready: true, paused: true,
    status: availability(), pending: null, busyRef: { current: false },
    generation: { current: 0 }, stillCurrentSession: () => currentSession,
    Crypto: { randomUUID: () => "id-one" }, isOwnStoreReadback: validate,
    updateOwnStoreOperationalAvailability: async (...args) => {
      calls.push(args);
      await request.promise;
    },
    readOwnStoreOperationalAvailability: async () => availability("store-a", false),
    setPending: next => { context.pending = next; events.push(["pending", next]); },
    setBusy: next => events.push(["busy", next]),
    setError: next => events.push(["error", next]),
    setStatus: next => events.push(["status", next]),
    setReadError: next => events.push(["readError", next]),
    signalStoreAvailabilityChanged: next => events.push(["signal", next]),
    httpStatus: error => error?.status ?? null,
    Error,
  };
  let currentSession = true;
  const resume = run(`${resumeDeclaration}\nresumeOrders`, context);
  return { resume, context, request, calls, events, switchSession: () => { currentSession = false; } };
}

test("late PUT result after Identity replacement cannot publish status or signal another Store session", async () => {
  const h = resumeHarness();
  const saving = h.resume();
  assert.equal(h.calls.length, 1);
  h.switchSession();
  h.request.resolve();
  await saving;
  assert.equal(h.events.filter(([kind]) => kind === "status").length, 0);
  assert.equal(h.events.filter(([kind]) => kind === "signal").length, 0);
  assert.equal(h.events.filter(([kind]) => kind === "pending").length, 1);
});

test("successful same-session resume reads DSH owner before clearing original idempotent attempt", async () => {
  const h = resumeHarness();
  const saving = h.resume();
  assert.match(h.calls[0][2], /^partner_resume_/);
  const attempt = h.context.pending;
  h.request.resolve();
  await saving;
  assert.ok(h.events.some(([kind, value]) => kind === "status" && value.availability.paused === false));
  assert.ok(h.events.some(([kind, value]) => kind === "pending" && value === null));
  assert.ok(h.events.some(([kind, value]) => kind === "signal" && value === "store-a"));
  assert.equal(h.calls[0][2], attempt.idempotencyKey);
});

test("uncertain resume retains one idempotency key for same-session retry and recovers from DSH", async () => {
  const h = resumeHarness();
  h.context.readOwnStoreOperationalAvailability = async () => availability("store-a", true);
  const first = h.resume();
  const originalKey = h.calls[0][2];
  h.request.reject(new Error("network timeout"));
  await first;
  assert.equal(h.context.pending.idempotencyKey, originalKey);
  assert.equal(h.context.busyRef.current, false);
  assert.ok(h.events.some(([kind, value]) => kind === "error" && value.includes("لم نتأكد")));

  h.context.updateOwnStoreOperationalAvailability = async (...args) => { h.calls.push(args); };
  h.context.readOwnStoreOperationalAvailability = async () => availability("store-a", false);
  await h.resume();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][2], originalKey);
  assert.ok(h.events.some(([kind, value]) => kind === "signal" && value === "store-a"));
  assert.equal(h.context.pending, null);
});

test("rendering and action guards hide stale availability during Identity transition", () => {
  assert.match(source, /const scopeCurrent = stillCurrentSession\(\)/);
  assert.match(source, /const ready = scopeCurrent && !readError && typeof status === "object"/);
  assert.match(source, /disabled=\{busy \|\| !scopeCurrent\}/);
  assert.match(source, /if \(!stillCurrentSession\(\)\) return/);
  assert.match(source, /if \(!isCurrent\(\)\) return/);
});
