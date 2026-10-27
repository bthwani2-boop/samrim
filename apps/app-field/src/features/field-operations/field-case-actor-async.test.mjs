import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../../../../../node_modules/.pnpm/typescript@6.0.2/node_modules/typescript/lib/typescript.js";

const source = readFileSync(new URL("./field-cases.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("field-cases.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);

function scope() {
  const actorScope = { current: { subject: "actor-a", revision: 0 } };
  return {
    actorScope,
    switchActor() { actorScope.current = { subject: "actor-b", revision: 1 }; },
    isActiveActor(snapshot) { return Boolean(snapshot.subject) && actorScope.current === snapshot; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function executeRealFunction(name, deps) {
  let target;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) target = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(target, name + " must be present in FieldCases");
  const compiled = ts.transpileModule(target.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("deps", "with (deps) { " + compiled + "; return " + name + "; }")(deps);
}

test("previous actor media read is discarded after the account changes", async () => {
  const state = scope(), pending = deferred(), media = [], busy = [];
  const fn = executeRealFunction("openStoreImage", {
    actorScope: state.actorScope, busy: "", storeImage: null, pendingImageAttempt: null, pendingInternalPhoto: null,
    getUsableIdentityAccessToken: async () => "token-a",
    fieldClient: () => ({ readOwnFieldJoiningCase: () => pending.promise }),
    setBusy: v => busy.push(v), setError: () => {}, setMediaCase: v => media.push(v),
    setStoreImage: () => {}, setInternalPhotoDraft: () => {}, console: { warn() {} },
  });
  const action = fn({ id: "case-a", state: "draft" });
  await Promise.resolve();
  state.switchActor();
  pending.resolve({ case: { id: "case-a" } });
  await action;
  assert.deepEqual(media, []);
  assert.deepEqual(busy, ["case-a"]);
});

test("current actor media read is accepted", async () => {
  const state = scope(), media = [];
  const fn = executeRealFunction("openStoreImage", {
    actorScope: state.actorScope, busy: "", storeImage: null, pendingImageAttempt: null, pendingInternalPhoto: null,
    getUsableIdentityAccessToken: async () => "token-a",
    fieldClient: () => ({ readOwnFieldJoiningCase: async () => ({ case: { id: "case-a" } }) }),
    setBusy: () => {}, setError: () => {}, setMediaCase: v => media.push(v), setStoreImage: () => {}, setInternalPhotoDraft: () => {},
  });
  await fn({ id: "case-a", state: "draft" });
  assert.equal(media.length, 1);
  assert.equal(media[0].case.id, "case-a");
});

test("old actor submit stops before a case read or mutation", async () => {
  const state = scope(), pending = deferred();
  let readCount = 0;
  const fn = executeRealFunction("submitCase", {
    actorScope: state.actorScope, isActiveActor: state.isActiveActor, busy: "", setBusy: () => {}, setError: () => {},
    getUsableIdentityAccessToken: () => pending.promise,
    fieldClient: () => ({ readOwnFieldJoiningCase: async () => { readCount += 1; return {}; } }),
  });
  const action = fn({ id: "case-a", state: "draft" });
  state.switchActor();
  pending.resolve("token-a");
  await action;
  assert.equal(readCount, 0);
});

test("old actor picker cannot reopen the image selector", async () => {
  const state = scope(), pending = deferred();
  let pickerOpens = 0;
  const fn = executeRealFunction("pickStoreImage", {
    actorScope: state.actorScope, isActiveActor: state.isActiveActor,
    mediaCase: { case: { ownerFullName: "Owner A" } }, busy: "", pendingImageAttempt: null,
    ImagePicker: {
      requestMediaLibraryPermissionsAsync: () => pending.promise,
      requestCameraPermissionsAsync: () => pending.promise,
      launchImageLibraryAsync: async () => { pickerOpens += 1; return { canceled: true }; },
    }, setError: () => {},
  });
  const action = fn("library");
  state.switchActor();
  pending.resolve({ granted: true });
  await action;
  assert.equal(pickerOpens, 0);
});

test("old actor private photo upload is not started after token resolution", async () => {
  const state = scope(), pending = deferred();
  let uploads = 0;
  const fn = executeRealFunction("uploadInternalStorePhoto", {
    actorScope: state.actorScope, isActiveActor: state.isActiveActor,
    mediaCase: { case: { id: "case-a", version: 1 } }, internalPhotoDraft: {},
    busy: "", pendingInternalPhoto: null, Crypto: { randomUUID: () => "uuid" },
    setPendingInternalPhoto: () => {}, setBusy: () => {}, setError: () => {},
    getUsableIdentityAccessToken: () => pending.promise,
    fieldClient: () => ({ uploadJoiningCaseStoreInternalPhoto: async () => { uploads += 1; return {}; } }),
  });
  const action = fn();
  state.switchActor();
  pending.resolve("token-a");
  await action;
  assert.equal(uploads, 0);
});

test("old actor public image upload is not started after token resolution", async () => {
  const state = scope(), pending = deferred();
  let uploads = 0;
  const fn = executeRealFunction("uploadStoreImage", {
    actorScope: state.actorScope, isActiveActor: state.isActiveActor,
    mediaCase: { case: { id: "case-a", version: 1 } }, storeImage: { provenance: {} }, busy: "",
    pendingImageAttempt: null, isMediaProvenanceInputValid: () => true, storeImageRole: "primary",
    Crypto: { randomUUID: () => "uuid" },
    setPendingImageAttempt: () => {}, setBusy: () => {}, setError: () => {},
    getUsableIdentityAccessToken: () => pending.promise,
    fieldClient: () => ({ uploadJoiningCaseStoreImage: async () => { uploads += 1; return {}; } }),
  });
  const action = fn();
  state.switchActor();
  pending.resolve("token-a");
  await action;
  assert.equal(uploads, 0);
});
