import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../../../../../node_modules/.pnpm/typescript@6.0.2/node_modules/typescript/lib/typescript.js";
import { tryAcquireFieldDraftMutation } from "./field-draft-mutation-lock.ts";

const source = readFileSync(new URL("./field-new-case.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("field-new-case.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);

function executeCreateCase(deps) {
  let target;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createCase") target = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(target, "createCase must be present in FieldNewCase");
  const compiled = ts.transpileModule(target.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("deps", "with (deps) { " + compiled + "; return createCase; }")(deps);
}

function setup(overrides = {}) {
  const actor = { subject: "field-a", revision: 0 };
  const state = { writes: 0, reads: 0, confirmed: [], pending: [], lock: { current: false } };
  const canonical = { case: { id: "case-a", origin: "field", state: "draft", version: 1 } };
  const deps = {
    actorScope: { current: actor }, renderedActor: actor, busy: false, draftConflictNeedsRead: false, createdCase: null, pendingDraftAttempt: null,
    normalizeYemenPhoneE164: value => value,
    input: { contactPhoneE164: "+967771234567", ownerFullName: "Owner A", businessName: "Business A", firstStoreName: "Store A", walletProviderKey: "", firstStoreAddress: "District road", serviceCityId: "city-a", firstStoreVerticalId: "vertical-a", firstStoreCommercialTypeId: "type-a", firstStoreProofNumber: "", firstStoreNotes: "", firstStoreFulfillmentModes: ["delivery"] },
    setActiveStep() {}, setError() {}, selectedProofType: "COMMERCIAL_REGISTRATION", proofDetailsDirty: false,
    workingHoursByDay: {}, enteredHours: [], toStoreWorkingHoursIntervals: () => [], selectedStoreOrigin: null,
    Crypto: { randomUUID: () => "uuid" }, tryAcquireFieldDraftMutation, draftMutationLock: state.lock,
    setPendingDraftAttempt(value) { state.pending.push(value); }, setBusy() {},
    getUsableIdentityAccessToken: async () => "token-a",
    fieldClient: () => ({
      createFieldJoiningCase: async (token, request, key) => { state.writes += 1; state.write = { token, request, key }; return canonical; },
      readOwnFieldJoiningCase: async (token, caseID) => { state.reads += 1; state.read = { token, caseID }; return canonical; },
    }),
    fieldDraftMatchesReadback: () => true, setCreatedCase(value) { state.confirmed.push(value); },
    setInput(update) { state.input = update(deps.input); }, setProofDetailsDirty() {}, setDraftConflict() {}, setDraftConflictNeedsRead() {},
    storeImage: null, reviewPhoto: null,
    ...overrides,
  };
  return { actor, state, deps };
}

test("current Field actor saves through DSH and confirms the canonical case readback", async () => {
  const { deps, state } = setup();
  await executeCreateCase(deps)(false);
  assert.equal(state.writes, 1);
  assert.deepEqual(state.read, { token: "token-a", caseID: "case-a" });
  assert.deepEqual(state.confirmed, [{ case: { id: "case-a", origin: "field", state: "draft", version: 1 } }]);
  assert.equal(state.lock.current, false);
});

test("actor switch while resolving the token prevents a stale Field draft mutation", async () => {
  let resolveToken;
  const token = new Promise(resolve => { resolveToken = resolve; });
  const { actor, deps, state } = setup({ getUsableIdentityAccessToken: () => token });
  const action = executeCreateCase(deps)(false);
  deps.actorScope.current = { subject: "field-b", revision: 1 };
  resolveToken("token-a");
  await action;
  assert.equal(state.writes, 0);
  assert.equal(state.reads, 0);
  assert.equal(state.confirmed.length, 0);
  assert.equal(state.lock.current, false);
});

test("an in-flight DSH write is read back but not exposed after the Field actor changes", async () => {
  let resolveWrite;
  const response = new Promise(resolve => { resolveWrite = resolve; });
  const { actor, deps, state } = setup({
    fieldClient: () => ({
      createFieldJoiningCase: async (token, request, key) => { state.writes += 1; state.write = { token, request, key }; return response; },
      readOwnFieldJoiningCase: async (token, caseID) => { state.reads += 1; state.read = { token, caseID }; return { case: { id: "case-a", origin: "field", state: "draft", version: 1 } }; },
    }),
  });
  const action = executeCreateCase(deps)(false);
  await Promise.resolve();
  deps.actorScope.current = { subject: "field-b", revision: actor.revision + 1 };
  resolveWrite({ case: { id: "case-a", version: 1 } });
  await action;
  assert.equal(state.writes, 1);
  assert.equal(state.reads, 1);
  assert.equal(state.confirmed.length, 0);
  assert.equal(state.lock.current, false);
});

function executeIdentitySubscription(deps) {
  let effect;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0] && node.arguments[0].getText(ast).includes("subscribeIdentitySession")) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(effect, "FieldNewCase must subscribe to Identity session changes");
  return new Function("deps", "with (deps) { return (" + effect.getText(ast) + "); }")(deps);
}

test("Identity actor change clears case and personal intake state", () => {
  let onIdentityChange;
  const cleared = {};
  const actorScope = { current: { subject: "field-a", revision: 0 } };
  const deps = {
    actorScope, caseId: "case-a", subscribeIdentitySession: callback => { onIdentityChange = callback; return () => {}; },
    setActorRevision: update => { cleared.actorRevision = update(0); },
    setInput: value => { cleared.input = value; }, setWorkingHoursByDay: value => { cleared.hours = value; },
    setSameBusinessAndStore: value => { cleared.sameName = value; }, setSelectedProofType: value => { cleared.proof = value; },
    setActiveStep: value => { cleared.step = value; }, setProofDetailsDirty: value => { cleared.proofDirty = value; },
    setDraftConflict: value => { cleared.conflict = value; }, setDraftConflictNeedsRead: value => { cleared.conflictNeedsRead = value; },
    setSelectedStoreOrigin: value => { cleared.location = value; }, setShowLocationMap: value => { cleared.map = value; },
    setCreatedCase: value => { cleared.case = value; }, setCaseLoading: value => { cleared.caseLoading = value; },
    setError: value => { cleared.error = value; }, setLocationMessage: value => { cleared.locationMessage = value; },
    setLocationError: value => { cleared.locationError = value; }, setLocationBusy: value => { cleared.locationBusy = value; },
    setStoreImage: value => { cleared.storeImage = value; }, setReviewPhoto: value => { cleared.reviewPhoto = value; },
    setPendingReviewPhotoAttempt: value => { cleared.reviewPhotoAttempt = value; }, setPendingDraftAttempt: value => { cleared.draftAttempt = value; },
    setPendingImageAttempt: value => { cleared.imageAttempt = value; },
    initialJoiningCaseInput: () => ({ contactPhoneE164: "" }), preloadedVerticalID: { current: "vertical-old" },
    commercialTypeReadSequence: { current: 4 },
  };
  executeIdentitySubscription(deps)();
  onIdentityChange({ kind: "authenticated", identity: { subject: "field-b" } });
  assert.deepEqual(actorScope.current, { subject: "field-b", revision: 1 });
  assert.deepEqual(cleared.input, { contactPhoneE164: "" });
  assert.equal(cleared.case, null);
  assert.equal(cleared.storeImage, null);
  assert.equal(cleared.draftAttempt, null);
  assert.equal(cleared.actorRevision, 1);
  assert.equal(deps.commercialTypeReadSequence.current, 5);
});
