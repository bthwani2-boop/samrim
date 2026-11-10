import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "./partner-setup-session-scope.ts";

const ui = readFileSync(new URL("./store-commercial-agreements.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./store-commercial-agreement-client.ts", import.meta.url), "utf8");
const session = id => partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: id } });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function production(source, name, kind) {
  const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (kind === "function" && ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node.getText(ast);
    }
    if (kind === "callback" && ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      const call = node.initializer;
      if (call && ts.isCallExpression(call) && call.expression.getText(ast) === "useCallback") {
        found = call.arguments[0]?.getText(ast);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${name} must use the actual production callback`);
  const code = kind === "function" ? `${found}\n${name};` : `const run = ${found};\nrun;`;
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

const readCode = production(ui, "load", "callback");
const consentCode = production(ui, "accept", "function");
const confirmCode = production(ui, "requestAcceptanceConfirmation", "function");
const requestCode = production(api, "request", "function");
const storeID = "store-a";
const storageKey = "bthwani.partner.store-agreement.accept.pending.v1.merchant-a.store-a";
const agreement = {
  agreementId: "agreement-a", storeId: storeID, partnerActorId: "merchant-a",
  agreementVersion: 3, status: "PROPOSED", commercialModel: "COMMISSION",
  rates: [{ fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 100 }],
};
const savedAttempt = {
  agreementId: agreement.agreementId,
  expectedAgreementVersion: agreement.agreementVersion,
  reason: "أوافق على الشروط المعروضة كاملة",
  idempotencyKey: "existing-idempotency",
  correlationID: "existing-correlation",
};
function fixture() {
  const firstSession = session("login-1");
  const viewScope = JSON.stringify([firstSession, storeID]);
  let now = firstSession;
  const storedRead = deferred();
  const agreementRead = deferred();
  const storeWrite = deferred();
  const accepted = deferred();
  const calls = [];
  const events = [];
  const capture = key => value => events.push([key, value]);
  const activeScope = { current: viewScope };
  const readSequence = { current: 0 };
  const acceptanceBusy = { current: false };
  const isCurrent = () => Boolean(firstSession) && now === firstSession && activeScope.current === viewScope;
  let loadCalls = 0;
  const ctx = {
    actorID: "merchant-a", sessionKey: firstSession, viewScope, storeID, storageKey,
    agreementsScope: viewScope, pendingStorageReady: true, busyAgreementID: "",
    pendingAttempt: null, readSequence, activeScope, acceptanceBusy,
    agreement, DEFAULT_ACCEPTANCE_REASON: "أوافق على شروط الاتفاقية كاملة",
    setAgreements: capture("agreements"), setAgreementsScope: capture("agreementsScope"),
    setFeedbackScope: capture("feedbackScope"), setPendingAttempt: capture("pendingAttempt"),
    setPendingStorageReady: capture("pendingStorageReady"), setLoading: capture("loading"),
    setError: capture("error"), setNotice: capture("notice"), setAgreementToConfirm: capture("confirm"),
    setBusyAgreementID: capture("busyAgreementID"),
    currentPartnerSessionKey: () => now, sessionCurrent: isCurrent,
    SecureStore: {
      getItemAsync: key => { calls.push(["get", key]); return storedRead.promise; },
      setItemAsync: (key, value) => { calls.push(["set", key, JSON.parse(value)]); return storeWrite.promise; },
      deleteItemAsync: async key => { calls.push(["delete", key]); },
    },
    isAcceptanceAttempt: value => value?.idempotencyKey === savedAttempt.idempotencyKey,
    readOwnStoreCommercialAgreements: (id, expected) => {
      calls.push(["read", id, expected]); return agreementRead.promise;
    },
    acceptOwnStoreCommercialAgreement: (...args) => {
      calls.push(["accept", ...args]); return accepted.promise;
    },
    newStoreAgreementMutationKeys: () => ({ idempotencyKey: "new-idempotency", correlationID: "new-correlation" }),
    isConfirmedOwnStoreAgreementAcceptance: value => Boolean(value && value.status === "PARTNER_ACCEPTED"),
    hasReviewableStoreAgreementRates: value => value.rates?.length > 0,
    agreementReadbackErrorMessage: () => "تعذر قراءة الاتفاقية",
    acceptanceErrorMessage: () => "لم يتم تأكيد القبول",
    load: async () => { loadCalls++; return [{ ...agreement, status: "PARTNER_ACCEPTED" }]; },
    Error,
  };
  return {
    ctx, calls, events, activeScope, readSequence, acceptanceBusy,
    storedRead, agreementRead, storeWrite, accepted,
    load: () => vm.runInNewContext(readCode, ctx)(),
    accept: () => vm.runInNewContext(consentCode, ctx)(agreement),
    requestConfirmation: () => vm.runInNewContext(confirmCode, ctx)(agreement),
    switchSession: () => { now = session("login-2"); },
    switchStore: () => { activeScope.current = JSON.stringify([firstSession, "store-b"]); },
    get loadCalls() { return loadCalls; },
  };
}

test("same actor replacement during saved-attempt read does not dispatch WLT agreement read", async () => {
  const h = fixture();
  const pending = h.load();
  assert.equal(h.calls[0][1], storageKey);
  h.switchSession();
  h.storedRead.resolve(null);
  await pending;
  assert.equal(h.calls.some(([name]) => name === "read"), false);
  assert.equal(h.events.some(([name, value]) => name === "agreements" && value?.length), false);
});

test("old session agreement response cannot populate the new private UI", async () => {
  const h = fixture();
  const pending = h.load();
  h.storedRead.resolve(null);
  await flush();
  assert.ok(h.calls.some(([name, id, expected]) => name === "read" && id === storeID && expected === h.ctx.sessionKey));
  h.switchSession();
  h.agreementRead.resolve([agreement]);
  await pending;
  assert.equal(h.events.some(([name, value]) => name === "agreementsScope" && value === h.ctx.viewScope), false);
  assert.equal(h.events.some(([name, value]) => name === "agreements" && value?.length), false);
});

test("current Partner session displays only Store-owned agreements under view scope", async () => {
  const h = fixture();
  const pending = h.load();
  h.storedRead.resolve(null);
  await flush();
  h.agreementRead.resolve([agreement]);
  await pending;
  assert.ok(h.events.some(([name, value]) => name === "agreements" && value?.[0]?.storeId === storeID));
  assert.ok(h.events.some(([name, value]) => name === "agreementsScope" && value === h.ctx.viewScope));
});

test("persisted recovery attempt retains its actor+Store key across renewed sessions", async () => {
  const h = fixture();
  const pending = h.load();
  h.storedRead.resolve(JSON.stringify(savedAttempt));
  await flush();
  h.agreementRead.resolve([agreement]);
  await pending;
  assert.ok(h.events.some(([name, value]) => name === "pendingAttempt" && value?.idempotencyKey === savedAttempt.idempotencyKey));
  assert.ok(h.calls.some(([name, key]) => name === "get" && key === storageKey));
  assert.doesNotMatch(storageKey, /login-1|login-2/);
});

test("same-actor reauthentication hides stale legal consent confirmation", () => {
  const h = fixture();
  h.switchSession();
  h.requestConfirmation();
  assert.equal(h.events.some(([name]) => name === "confirm"), false);
});

test("identity rotation after durable attempt save blocks acceptance POST", async () => {
  const h = fixture();
  const pending = h.accept();
  assert.ok(h.calls.some(([name, key]) => name === "set" && key === storageKey));
  h.switchSession();
  h.storeWrite.resolve();
  await pending;
  assert.equal(h.calls.some(([name]) => name === "accept"), false);
  assert.equal(h.calls.some(([name]) => name === "delete"), false);
});

test("old session response after WLT acceptance never clears the durable recovery attempt", async () => {
  const h = fixture();
  const pending = h.accept();
  h.storeWrite.resolve();
  await flush();
  const acceptance = h.calls.find(([name]) => name === "accept");
  assert.equal(acceptance?.[1], storeID);
  assert.equal(acceptance?.[6], h.ctx.sessionKey);
  h.switchSession();
  h.accepted.resolve({ ...agreement, status: "PARTNER_ACCEPTED" });
  await pending;
  assert.equal(h.calls.some(([name]) => name === "delete"), false);
  assert.equal(h.events.some(([name, value]) => name === "notice" && value?.includes("قبولك")), false);
  assert.equal(h.loadCalls, 0);
});

test("same-session Partner acceptance requires exact reviewed agreement and canonical WLT readback", async () => {
  const h = fixture();
  const pending = h.accept();
  h.storeWrite.resolve();
  await flush();
  h.accepted.resolve({ ...agreement, status: "PARTNER_ACCEPTED" });
  await pending;
  const acceptance = h.calls.find(([name]) => name === "accept");
  assert.equal(acceptance[1], storeID);
  assert.equal(acceptance[2], agreement.agreementId);
  assert.equal(acceptance[3].expectedAgreementVersion, agreement.agreementVersion);
  assert.equal(acceptance[4], "new-idempotency");
  assert.equal(acceptance[5], "new-correlation");
  assert.equal(h.loadCalls, 1);
  assert.ok(h.calls.some(([name, key]) => name === "delete" && key === storageKey));
  assert.ok(h.events.some(([name, value]) => name === "notice" && String(value).includes("قبولك")));
});

test("uncertain outcome retains same durable retry keys and never generates new keys", async () => {
  const h = fixture();
  h.ctx.pendingAttempt = savedAttempt;
  const pending = h.accept();
  assert.equal(h.calls.some(([name]) => name === "set"), false);
  h.accepted.reject(new Error("NETWORK_DOWN"));
  await pending;
  const call = h.calls.find(([name]) => name === "accept");
  assert.equal(call[4], savedAttempt.idempotencyKey);
  assert.equal(call[5], savedAttempt.correlationID);
  assert.equal(h.calls.some(([name]) => name === "delete"), false);
});

test("double click uses in-flight ref to prevent two acceptance commands", async () => {
  const h = fixture();
  const first = h.accept();
  const second = h.accept();
  assert.equal(h.calls.filter(([name]) => name === "set").length, 1);
  h.storeWrite.resolve();
  await flush();
  h.accepted.resolve({ ...agreement, status: "PARTNER_ACCEPTED" });
  await Promise.all([first, second]);
  assert.equal(h.calls.filter(([name]) => name === "accept").length, 1);
});

test("client refuses POST if original Identity session changes while access token is awaited", async () => {
  const original = session("login-1");
  const token = deferred();
  let now = original;
  const fetches = [];
  const ctx = {
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: now === original ? "login-1" : "login-2" } }),
    partnerSetupSessionKey, getUsableIdentityAccessToken: () => token.promise,
    dshBaseUrl: () => "https://dsh.fixture.invalid",
    fetch: (...args) => { fetches.push(args); return Promise.resolve({ ok: true, json: async () => ({}) }); },
    Error,
  };
  const request = vm.runInNewContext(requestCode, ctx);
  const pending = request("/dsh/partner/stores/store-a/commercial-agreements/agreement-a/accept", "POST", {}, { idempotencyKey: "k", correlationID: "c" }, original);
  now = session("login-2");
  token.resolve("stale-token");
  await assert.rejects(pending, /PARTNER_AGREEMENT_SESSION_CHANGED/);
  assert.equal(fetches.length, 0);
});

test("source preserves one WLT writer, owner approval, rejection and private-session rendering", () => {
  assert.match(ui, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(ui, /JSON\.stringify\(\[sessionKey, storeID\]\)/);
  assert.match(ui, /sessionCurrent\(\) && agreementsScope === viewScope/);
  assert.match(ui, /sessionCurrent\(\) && agreementToConfirm && agreementsScope === viewScope/);
  assert.match(ui, /acceptOwnStoreCommercialAgreement\([\s\S]*?attempt\.idempotencyKey, attempt\.correlationID, sessionKey\)/);
  assert.match(ui, /isConfirmedOwnStoreAgreementAcceptance\(canonical, expected\)/);
  assert.match(ui, /historicalCommissionReadback/);
  assert.match(ui, /لا يسري أي اتفاق دون قبولك وموافقة المالية/);
  assert.match(api, /PARTNER_AGREEMENT_SESSION_CHANGED/);
  assert.match(api, /expectedSession/);
  assert.doesNotMatch(ui, /setAgreementsScope\(storageKey\)|agreementsScope === storageKey|feedbackScope === storageKey/);
});


test("other Store scope cannot render WLT response or accept legal terms", async () => {
  const h = fixture();
  const read = h.load();
  h.storedRead.resolve(null);
  await flush();
  h.switchStore();
  h.agreementRead.resolve([agreement]);
  await read;
  h.requestConfirmation();
  assert.equal(h.events.some(([name, value]) => name === "agreements" && value?.length), false);
  assert.equal(h.events.some(([name, value]) => name === "confirm" && value), false);
});

test("different Partner actor agreement in a successful response fails closed", async () => {
  const h = fixture();
  const pending = h.load();
  h.storedRead.resolve(null);
  await flush();
  h.agreementRead.resolve([{ ...agreement, partnerActorId: "other-merchant" }]);
  await pending;
  assert.equal(h.events.some(([name, value]) => name === "agreements" && value?.length), false);
  assert.ok(h.events.some(([name, value]) => name === "error" && value === "تعذر قراءة الاتفاقية"));
});

test("current Partner session request forwards exact bearer and idempotency keys", async () => {
  const original = session("login-1");
  const fetches = [];
  const ctx = {
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: "login-1" } }),
    partnerSetupSessionKey,
    getUsableIdentityAccessToken: async () => "valid-access-token",
    dshBaseUrl: () => "https://dsh.fixture.invalid",
    fetch: (...args) => { fetches.push(args); return Promise.resolve({ ok: true, json: async () => ({ agreement: agreement }) }); },
    Error,
  };
  const request = vm.runInNewContext(requestCode, ctx);
  const payload = await request("/dsh/partner/stores/store-a/commercial-agreements/agreement-a/accept",
    "POST", { expectedAgreementVersion: 3, reason: "قبول العقد" },
    { idempotencyKey: "existing-idempotency", correlationID: "existing-correlation" }, original);
  assert.equal(payload.agreement.agreementId, agreement.agreementId);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0][1].headers.Authorization, "Bearer valid-access-token");
  assert.equal(fetches[0][1].headers["Idempotency-Key"], "existing-idempotency");
  assert.equal(fetches[0][1].headers["X-Correlation-ID"], "existing-correlation");
});

test("a different authenticated login cannot reuse another session's expected request key", async () => {
  const original = session("login-1");
  const fetches = [];
  const ctx = {
    currentIdentityState: () => ({ kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: "login-2" } }),
    partnerSetupSessionKey, getUsableIdentityAccessToken: async () => "token-of-new-login",
    dshBaseUrl: () => "https://dsh.fixture.invalid",
    fetch: (...args) => { fetches.push(args); return Promise.resolve({ ok: true, json: async () => ({}) }); },
    Error,
  };
  await assert.rejects(vm.runInNewContext(requestCode, ctx)("/commercial-agreements", "POST", {}, null, original),
    /PARTNER_AGREEMENT_SESSION_CHANGED/);
  assert.equal(fetches.length, 0);
});
