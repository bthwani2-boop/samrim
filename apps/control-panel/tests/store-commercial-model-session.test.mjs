import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { storeCommercialRatesForProposal, matchesProposedStoreAgreement } from "../src/features/partner-onboarding/store-commercial-proposal-rates.ts";

const root = path.resolve(import.meta.dirname, "../src/features");
const policy = readFileSync(path.join(root, "policies/store-commercial-model-policy-workspace.tsx"), "utf8");
const proposal = readFileSync(path.join(root, "partner-onboarding/store-commercial-agreement-proposal.tsx"), "utf8");

const lookupStart = policy.indexOf("  const readStore = useCallback(async (storeId: string) => {");
const lookupEnd = policy.indexOf("\n  }, []);", lookupStart);
assert.ok(lookupStart >= 0 && lookupEnd > lookupStart);
const lookupCode = policy.slice(lookupStart, lookupEnd + "\n  }, []);".length)
  .replace("async (storeId: string)", "async (storeId)")
  .replace(" as StorePublicationResponse", "");

const proposeStart = proposal.indexOf("  async function propose() {");
const proposeEnd = proposal.indexOf("\n\n  return <section", proposeStart);
assert.ok(proposeStart >= 0 && proposeEnd > proposeStart);
const proposeCode = proposal.slice(proposeStart, proposeEnd)
  .replace("const expected: ExpectedStoreCommercialProposal", "const expected")
  .replace(" as { agreement?: Agreement }", "");

function runStoreLookup(fetch, signalAPI = AbortSignal) {
  const sequence = { current: 0 };
  const activeRead = { current: null };
  const state = { selected: [], errors: [], loading: [] };
  const readStore = runInNewContext(lookupCode + "\nreadStore", {
    useCallback: callback => callback,
    sequence, activeRead, AbortController, AbortSignal: signalAPI, Error, encodeURIComponent,
    fetch, validModes: new Set(["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"]),
    setSelected: value => state.selected.push(value),
    setLoading: value => state.loading.push(value),
    setError: value => state.errors.push(value),
  });
  return { readStore, activeRead, sequence, state };
}

const validStore = id => ({ id, fulfillmentModes: ["CUSTOMER_PICKUP"] });
const storeReply = id => ({ ok: true, json: async () => ({ store: validStore(id) }) });
const agreement = {
  agreementId: "proposal-1", storeId: "store-a", partnerActorId: "partner-a",
  proposedByActorId: "operator-a", agreementVersion: 1,
  reason: "اقتراح شروط تجارية بانتظار قبول الشريك واعتماد المالية",
  commercialModel: "COMMISSION", status: "PROPOSED",
  rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }],
  recurringAmountMinor: 0, billingPeriod: "NONE", billingTimeZone: "Asia/Aden",
  invoiceDueDays: 0, graceDays: 0, renewalPolicy: "NONE",
  terminationTerms: "", adjustmentTerms: "",
};
const response = () => ({ ok: true, json: async () => ({ agreement }) });
const defaultFeeStart = proposal.indexOf("function hasOnlyDefaultDeliveryFeeTerms(item: Agreement): boolean {");
const defaultFeeEnd = proposal.indexOf("\n}", defaultFeeStart);
assert.ok(defaultFeeStart >= 0 && defaultFeeEnd > defaultFeeStart);
const hasOnlyDefaultDeliveryFeeTerms = runInNewContext(
  proposal.slice(defaultFeeStart, defaultFeeEnd + 2)
    .replace("item: Agreement", "item")
    .replace("): boolean", ")") +
  "\nhasOnlyDefaultDeliveryFeeTerms",
);

function runProposal({ fetch, headers, read, existingError = "", requiringConfirmation = false,
  signalAPI = AbortSignal, modes = ["CUSTOMER_PICKUP"] } = {}) {
  const proposalController = { current: null };
  const state = { busy: [], errors: [], notices: [], agreements: [], confirmation: [] };
  const requests = [];
  const reads = [];
  const trigger = runInNewContext(proposeCode + "\n({ operation: propose(), repeat: propose })", {
    readOnly: false, busy: false, error: existingError, requiresConfirmation: requiringConfirmation, actorId: "operator-a", nextProposalVersion: 0,
    modes, labels: { CUSTOMER_PICKUP: "استلام العميل", BTHWANI_CAPTAIN: "توصيل بثواني" },
    commercialModel: "COMMISSION", commissionPercentByMode: { CUSTOMER_PICKUP: "0", BTHWANI_CAPTAIN: "0" },
    recurringAmount: "", billingPeriod: "MONTHLY", invoiceDueDays: "7",
    graceDays: "3", renewalPolicy: "MANUAL", terminationTerms: "", adjustmentTerms: "",
    proposalReason: agreement.reason,
    storeId: "store-a", url: "/api/partners/stores/store-a/commercial-agreements",
    proposalController, AbortController, AbortSignal: signalAPI,
    storeCommercialRatesForProposal,
    stablePartnerMutationHeaders: (...args) => (headers ? headers(...args) : Promise.resolve({ "Idempotency-Key": "same-key" })),
    fetch: (...args) => {
      requests.push(args);
      return fetch ? fetch(...args) : Promise.resolve(response());
    },
    read: (...args) => {
      reads.push(args);
      return read ? read(...args) : Promise.resolve([agreement]);
    },
    matchesProposedStoreAgreement, hasOnlyDefaultDeliveryFeeTerms,
    setBusy: value => state.busy.push(value),
    setError: value => state.errors.push(value),
    setNotice: value => state.notices.push(value),
    setAgreements: value => state.agreements.push(value),
    setRequiresConfirmation: value => state.confirmation.push(value),
  });
  return { ...trigger, proposalController, state, requests, reads };
}

test("commercial model editor and proposal are keyed to complete Operator Identity session", () => {
  assert.match(policy, /permissions\.includes\("finance"\) && permissions\.includes\("partners"\)/);
  assert.match(policy, /Boolean\(state\.identity\.subject && state\.identity\.sessionId\)/);
  assert.match(policy, /JSON\.stringify\(\[state\.identity\.subject, state\.identity\.sessionId\]\)/);
  assert.match(policy, /<StoreCommercialModelPolicyEditor key=\{sessionKey\}/);
  assert.match(proposal, /JSON\.stringify\(\[state\.identity\.subject, state\.identity\.sessionId, props\.storeId\]\)/);
  assert.match(proposal, /<StoreCommercialAgreementEditor key=\{sessionKey\}/);
  assert.match(proposal, /proposalController\.current\?\.abort\(\)/);
  assert.notEqual(JSON.stringify(["operator-a", "session-1"]), JSON.stringify(["operator-a", "session-2"]));
});

test("delayed manually searched DSH Store read cannot set private selected Store after session unmount", async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const run = runStoreLookup(() => pending);
  const task = run.readStore("store-a");
  assert.ok(run.activeRead.current);
  run.activeRead.current.abort();
  run.sequence.current += 1;
  complete(storeReply("store-a"));
  await task;
  assert.deepEqual(run.state.selected, [null]);
  assert.deepEqual(run.state.errors, [""]);
  assert.deepEqual(run.state.loading, [true]);
});

test("new Store lookup cancels older in-flight read while current matching Store loads", async () => {
  let completeOld;
  const oldPending = new Promise(resolve => { completeOld = resolve; });
  const run = runStoreLookup((url) => url.includes("store-a") ? oldPending : Promise.resolve(storeReply("store-b")));
  const oldTask = run.readStore("store-a");
  const newTask = run.readStore("store-b");
  completeOld(storeReply("store-a"));
  await Promise.all([oldTask, newTask]);
  assert.equal(run.state.selected.at(-1)?.id, "store-b");
  assert.equal(run.activeRead.current, null);
  assert.equal(run.state.loading.at(-1), false);
});

test("same-session direct Store lookup validates ID/modes before enabling commercial agreement", async () => {
  const run = runStoreLookup(async () => storeReply("store-a"));
  await run.readStore("store-a");
  assert.equal(run.state.selected.at(-1)?.id, "store-a");
  const wrong = runStoreLookup(async () => storeReply("unrelated-store"));
  await wrong.readStore("store-a");
  assert.equal(wrong.state.selected.at(-1), null);
  assert.match(wrong.state.errors.at(-1), /مطابقة المتجر/);
});

test("commercial proposal never sends POST if old session expires before async idempotency headers resolve", async () => {
  let deliverHeaders;
  const pending = new Promise(resolve => { deliverHeaders = resolve; });
  const run = runProposal({ headers: () => pending });
  assert.ok(run.proposalController.current);
  run.proposalController.current.abort(); // existing component cleanup on session change
  deliverHeaders({ "Idempotency-Key": "old-session-idempotency-key" });
  await run.operation;
  assert.equal(run.requests.length, 0);
  assert.equal(run.reads.length, 0);
  assert.deepEqual(run.state.notices, [""]);
  assert.deepEqual(run.state.errors, [""]);
});

test("commercial proposal ignores stale POST success and does not read old WLT after session switch", async () => {
  let completePost;
  const pending = new Promise(resolve => { completePost = resolve; });
  const run = runProposal({ fetch: () => pending });
  for (let i = 0; i < 10 && !run.requests.length; i += 1) await Promise.resolve();
  assert.equal(run.requests.length, 1);
  const signal = run.requests[0][1].signal;
  run.proposalController.current.abort();
  assert.equal(signal.aborted, true);
  completePost(response());
  await run.operation;
  assert.equal(run.reads.length, 0);
  assert.deepEqual(run.state.notices, [""]);
  assert.deepEqual(run.state.errors, [""]);
});

test("confirmed same-session proposal uses one POST and owner readback before success", async () => {
  const run = runProposal();
  await run.operation;
  assert.equal(run.requests.length, 1);
  assert.equal(run.requests[0][1].method, "POST");
  assert.ok(run.requests[0][1].signal);
  assert.equal(run.reads.length, 1);
  assert.notStrictEqual(run.reads[0][0], run.requests[0][1].signal,
    "POST has its own timeout but canonical GET remains tied to the active session controller");
  assert.equal(run.reads[0][0].aborted, false);
  assert.equal(run.requests[0][1].signal.aborted, false);
  assert.match(run.state.notices.at(-1), /حُفظ اقتراح العمولة/);
  assert.equal(run.state.busy.at(-1), false);
  assert.equal(run.proposalController.current, null);
});

test("proposal canonical readback mismatch fails closed without duplicate POST", async () => {
  const run = runProposal({ read: async () => [] });
  await run.operation;
  assert.equal(run.requests.length, 1);
  assert.equal(run.reads.length, 2, "one attempt to reconcile ambiguous status");
  assert.deepEqual(run.state.notices, [""]);
  assert.match(run.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
});

test("rapid commercial proposal double-submit dispatches only one POST", async () => {
  let deliverHeaders;
  const pending = new Promise(resolve => { deliverHeaders = resolve; });
  const run = runProposal({ headers: () => pending });
  await run.repeat();
  assert.equal(run.requests.length, 0);
  run.proposalController.current.abort();
  deliverHeaders({ "Idempotency-Key": "request-1" });
  await run.operation;
  assert.equal(run.requests.length, 0);
});

function runAgreementRead(fetch, signalAPI = AbortSignal) {
  const begin = proposal.indexOf("  const read = useCallback(async (signal?: AbortSignal) => {");
  const end = proposal.indexOf("\n  }, [url, storeId]);", begin);
  assert.ok(begin >= 0 && end > begin);
  const code = proposal.slice(begin, end + "\n  }, [url, storeId]);".length)
    .replace("async (signal?: AbortSignal)", "async (signal)")
    .replace("const body: unknown", "const body")
    .replace(" as Agreement[]", "");
  const readSequence = { current: 0 };
  const agreements = [];
  const notices = [];
  const read = runInNewContext(code + "\nread", {
    useCallback: callback => callback, readSequence, AbortSignal: signalAPI,
    url: "/api/partners/stores/store-a/commercial-agreements", storeId: "store-a",
    labels: { BTHWANI_CAPTAIN: "توصيل بثواني", PARTNER_CAPTAIN: "توصيل المتجر", CUSTOMER_PICKUP: "استلام العميل" },
    fetch, setAgreements: value => agreements.push(value),
    setNotice: value => notices.push(value),
  });
  return { read, readSequence, agreements, notices };
}

test("old operator's delayed agreement GET cannot restore private finance rows after session switch", async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const run = runAgreementRead(() => pending);
  const controller = new AbortController();
  const task = run.read(controller.signal);
  controller.abort();
  run.readSequence.current++;
  deliver({ ok: true, json: async () => ({ agreements: [agreement] }) });
  await assert.rejects(task, /AGREEMENT_READ_SUPERSEDED/);
  assert.deepEqual(run.agreements, [null]);
});

test("same-session agreement GET retains only the matching Store's validated agreements", async () => {
  const run = runAgreementRead(async () => ({ ok: true, json: async () => ({ agreements: [agreement] }) }));
  const controller = new AbortController();
  const readback = await run.read(controller.signal);
  assert.equal(readback[0].storeId, "store-a");
  assert.equal(run.agreements.length, 2);
  assert.equal(run.agreements[0], null);

  const invalid = runAgreementRead(async () => ({
    ok: true, json: async () => ({ agreements: [{ ...agreement, storeId: "other-store" }] }),
  }));
  await assert.rejects(invalid.read(new AbortController().signal), /AGREEMENT_READ_INVALID/);
  assert.deepEqual(invalid.agreements, [null]);
});

test("agreement row visibility fails closed when operator partners permission is revoked within same session", () => {
  const start = proposal.indexOf("  const permitted = ");
  const end = proposal.indexOf("\n  if (!permitted", start);
  assert.ok(start >= 0 && end > start, "use production authorization expression");
  const actualGuard = proposal.slice(start, end);
  function check({ role = "operator", permissions = ["partners"], kind = "authenticated",
    subject = "operator-a", sessionId = "session-a", readOnly = true } = {}) {
    const state = kind === "authenticated"
      ? { kind, identity: { role, permissions, subject, sessionId } }
      : { kind };
    return runInNewContext(actualGuard + "\npermitted", { state, props: { readOnly } });
  }
  assert.equal(check(), true, "read-only agreements use existing partners permission");
  assert.equal(check({ permissions: ["partners"], readOnly: false }), false,
    "partner permission alone never opens financial mutation");
  assert.equal(check({ permissions: ["partners", "finance"], readOnly: false }), false);
  assert.equal(check({ permissions: ["partners", "platform_policies"], readOnly: false }), false);
  assert.equal(check({ permissions: ["partners", "platform_policies", "finance"], readOnly: false }), true);
  assert.equal(check({ permissions: [] }), false,
    "same actor and same session with revoked partners permission hides private agreements");
  assert.equal(check({ role: "partner" }), false);
  assert.equal(check({ subject: "" }), false);
  assert.equal(check({ sessionId: "" }), false);
  assert.equal(check({ kind: "signed_out" }), false);
  assert.match(proposal, /if \(!permitted \|\| state.kind !== "authenticated"\) \{\s*return/);
});

test("financial proposal remains blocked after an ambiguous mutation until operator explicitly rereads", async () => {
  const run = runProposal({
    requiringConfirmation: true,
    fetch: () => { throw new Error("must not POST while outcome is ambiguous"); },
  });
  await run.operation;
  assert.equal(run.requests.length, 0);
  assert.equal(run.reads.length, 0);
  assert.match(proposal, /readOnly \|\| busy \|\| proposalController\.current \|\| requiresConfirmation/);
  assert.match(proposal, /disabled=\{busy \|\| requiresConfirmation/);
  assert.match(proposal, /read\(\)\.then\(\(\) => setRequiresConfirmation\(false\)\)/);
});

test("refreshing the agreement ledger hides stale private rows before GET and leaves them hidden on failure", async () => {
  let reads = 0;
  let completeFailure;
  const deferred = new Promise((_resolve, reject) => { completeFailure = reject; });
  const run = runAgreementRead(() => {
    reads += 1;
    if (reads === 1) return Promise.resolve({
      ok: true, json: async () => ({ agreements: [agreement] }),
    });
    return deferred;
  });
  const controller = new AbortController();
  await run.read(controller.signal);
  assert.equal(run.agreements.at(-1)[0].agreementId, "proposal-1");
  const retry = run.read(controller.signal);
  assert.equal(reads, 2);
  assert.equal(run.agreements.at(-1), null, "old readback is not actionable during an in-flight refresh");
  assert.equal(run.notices.at(-1), "", "previous success notice is not current proof");
  completeFailure(new Error("canonical WLT readback unavailable"));
  await assert.rejects(retry, /canonical WLT readback unavailable/);
  assert.equal(run.agreements.at(-1), null, "failed re-read never restores stale agreement list");
});

test("a superseded pending agreement read cannot restore stale rows after a failed newer refresh", async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  let index = 0;
  const run = runAgreementRead(() => ++index === 1 ? old : Promise.resolve({ ok: false, json: async () => ({}) }));
  const controller = new AbortController();
  const prior = run.read(controller.signal);
  const fresh = run.read(controller.signal);
  await assert.rejects(fresh, /AGREEMENT_READ_UNAVAILABLE/);
  resolveOld({ ok: true, json: async () => ({ agreements: [agreement] }) });
  await assert.rejects(prior, /AGREEMENT_READ_SUPERSEDED/);
  assert.deepEqual(run.agreements, [null, null]);
});

test("ordinary form validation error does not require financial readback before correcting fields", async () => {
  const run = runProposal({ existingError: "تحقق من النسبة والمبلغ وشروط العقد" });
  await run.operation;
  assert.equal(run.requests.length, 1, "old form error alone does not lock validated submission");
  assert.equal(run.state.confirmation.length, 0);
  assert.match(run.state.notices.at(-1), /حُفظ اقتراح العمولة/);
});

test("uncertain commercial POST sets an explicit readback gate without automatic replay", async () => {
  const run = runProposal({ fetch: async () => { throw new Error("network timeout after POST"); } });
  await run.operation;
  assert.equal(run.requests.length, 1);
  assert.equal(run.state.confirmation.at(-1), true);
  assert.match(run.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
  assert.equal(run.requests.length, 1);
});

test("header-generation failure before POST is local and does not falsely lock financial mutation", async () => {
  const run = runProposal({
    headers: async () => { throw new Error("crypto.subtle unavailable"); },
    fetch: async () => { throw new Error("POST must not start"); },
    read: async () => { throw new Error("WLT must not be queried after preflight-only failure"); },
  });
  await run.operation;
  assert.equal(run.requests.length, 0);
  assert.equal(run.reads.length, 0);
  assert.deepEqual(run.state.confirmation, [], "a never-sent request is not an unknown WLT mutation");
  assert.match(run.state.errors.at(-1), /لم يُرسل أي طلب/);
  assert.equal(run.state.busy.at(-1), false);
  assert.equal(run.proposalController.current, null);
});

test("a synchronous POST invocation failure remains ambiguous and requires canonical read", async () => {
  const run = runProposal({ fetch: () => { throw new Error("post request attempted"); } });
  await run.operation;
  assert.equal(run.requests.length, 1);
  assert.equal(run.reads.length, 1);
  assert.equal(run.state.confirmation.at(-1), true);
  assert.match(run.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
});

test("preflight never changes the POST-ambiguity fail-closed guard", () => {
  assert.match(proposal, /let postAttempted = false;/);
  assert.match(proposal, /postAttempted = true;\s*const response = await fetch\(url/);
  assert.match(proposal, /if \(!postAttempted\) \{[\s\S]*?لم يُرسل أي طلب/);
});

test("manual financial recovery releases proposal lock only after canonical GET success", async () => {
  const sourceHandler = proposal.match(/onClick=\{(\(\) => \{ setError\("".*?void read\(\)\.then\(\(\) => setRequiresConfirmation\(false\)\).*?\})\}/)?.[1];
  assert.ok(sourceHandler, "must exercise the existing production recovery control");
  const make = (read) => {
    const errors = [], gates = [];
    const handler = runInNewContext("(" + sourceHandler + ")", {
      read, setError: value => errors.push(value),
      setRequiresConfirmation: value => gates.push(value),
    });
    return { handler, errors, gates };
  };
  const pass = make(async () => [{ agreementId: "canonical-1" }]);
  pass.handler();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pass.gates, [false], "successful canonical read permits a new proposal");
  assert.deepEqual(pass.errors, [""]);

  const fail = make(async () => { throw new Error("WLT owner unavailable"); });
  fail.handler();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fail.gates, [], "unavailable owner never unlocks uncertain financial write");
  assert.match(fail.errors.at(-1), /تعذرت إعادة القراءة/);
});

test("malformed canonical WLT rate rows are rejected before React may render or act on them", async () => {
  const invalidRows = [
    null,
    { ...agreement, rates: [null] },
    { ...agreement, rates: [{ fulfillmentMode: "UNKNOWN_MODE", commissionRateBps: 0 }] },
    { ...agreement, rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: -1 }] },
    { ...agreement, rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 10001 }] },
    { ...agreement, rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: "500" }] },
    { ...agreement, rates: [
      { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 200 },
      { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 200 },
    ] },
    { ...agreement, agreementId: null },
    { ...agreement, agreementVersion: 0 },
  ];
  for (const row of invalidRows) {
    const run = runAgreementRead(async () => ({ ok: true, json: async () => ({ agreements: [row] }) }));
    await assert.rejects(run.read(new AbortController().signal), /AGREEMENT_READ_INVALID/);
    assert.deepEqual(run.agreements, [null], "invalid WLT row is never published to the financial UI");
  }
  const duplicate = runAgreementRead(async () => ({
    ok: true, json: async () => ({ agreements: [agreement, { ...agreement, agreementVersion: 2 }] }),
  }));
  await assert.rejects(duplicate.read(new AbortController().signal), /AGREEMENT_READ_INVALID/);
  assert.deepEqual(duplicate.agreements, [null]);
});

test("a valid canonical commission rate renders without weakening WLT readback shape validation", async () => {
  const rate = { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 350 };
  const valid = runAgreementRead(async () => ({
    ok: true,
    json: async () => ({ agreements: [{ ...agreement, rates: [rate] }] }),
  }));
  const actual = await valid.read(new AbortController().signal);
  assert.equal(actual[0].rates[0].commissionRateBps, 350);
  assert.equal(valid.agreements.length, 2, "pending list cleared, then validated current list set");
  assert.equal(valid.agreements[0], null);
});

test("WLT canonical list rejects partnerless and empty/more-than-3 financial rate rows", async () => {
  const invalid = [
    { ...agreement, partnerActorId: "" },
    { ...agreement, partnerActorId: null },
    { ...agreement, partnerActorId: "  " },
    { ...agreement, rates: [] },
    { ...agreement, rates: [
      { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0 },
      { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0 },
      { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 },
      { fulfillmentMode: "OTHER", commissionRateBps: 0 },
    ] },
  ];
  for (const row of invalid) {
    const run = runAgreementRead(async () => ({ ok: true, json: async () => ({ agreements: [row] }) }));
    await assert.rejects(run.read(new AbortController().signal), /AGREEMENT_READ_INVALID/);
    assert.deepEqual(run.agreements, [null], "incomplete WLT row must not appear in financial proposal registry");
  }
});

test("WLT list accepts complete partner attribution and one valid commercial mode", async () => {
  const run = runAgreementRead(async () => ({ ok: true, json: async () => ({ agreements: [agreement] }) }));
  const records = await run.read(new AbortController().signal);
  assert.equal(records[0].partnerActorId, "partner-a");
  assert.equal(records[0].rates.length, 1);
  assert.equal(run.agreements[0], null);
  assert.equal(run.agreements[1][0].agreementId, "proposal-1");
});

test("confirmed WLT proposal uses production rate converter and verifies every contractual field", async () => {
  const run = runProposal();
  await run.operation;
  assert.equal(run.requests.length, 1);
  const payload = JSON.parse(run.requests[0][1].body);
  assert.equal(payload.commercialModel, "COMMISSION");
  assert.equal(payload.expectedCurrentVersion, 0);
  assert.equal(payload.reason, agreement.reason);
  assert.deepEqual(payload.rates, [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 }]);
  assert.equal(run.reads.length, 1);
  assert.match(run.state.notices.at(-1), /حُفظ اقتراح العمولة/);
  assert.equal(run.state.confirmation.length, 0);
});

test("real financial readback verifier rejects altered proposal terms instead of claiming saved", async () => {
  const mutations = [
    { reason: "altered agreement cause" },
    { status: "ACTIVE" },
    { proposedByActorId: "some-other-operator" },
    { agreementVersion: 2 },
    { commercialModel: "SUBSCRIPTION" },
    { rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 300 }] },
    { recurringAmountMinor: 1 },
    { billingPeriod: "MONTHLY" },
    { billingTimeZone: "UTC" },
    { invoiceDueDays: 1 },
    { graceDays: 1 },
    { renewalPolicy: "AUTOMATIC" },
    { terminationTerms: "other termination" },
    { adjustmentTerms: "other adjustment" },
  ];
  for (const change of mutations) {
    const run = runProposal({
      fetch: async () => ({ ok: true, json: async () => ({ agreement: { ...agreement, ...change } }) }),
    });
    await run.operation;
    assert.equal(run.requests.length, 1, "no duplicate POST for mismatched response");
    assert.equal(run.reads.length, 1, "ambiguity is reconciled through canonical GET");
    assert.deepEqual(run.state.notices, [""], "no optimistic success for altered contractual terms");
    assert.equal(run.state.confirmation.at(-1), true);
    assert.match(run.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
  }
});

test("successful POST but different canonical WLT GET terms never confirms the proposal", async () => {
  const run = runProposal({
    read: async () => [{ ...agreement, rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 100 }] }],
  });
  await run.operation;
  assert.equal(run.requests.length, 1);
  assert.equal(run.reads.length, 2, "canonical mismatch invokes one GET-only reconciliation");
  assert.deepEqual(run.state.notices, [""]);
  assert.equal(run.state.confirmation.at(-1), true);
});

function boundedSignalAPI(expectedDuration) {
  return {
    any: signals => AbortSignal.any(signals),
    timeout: milliseconds => {
      assert.equal(milliseconds, expectedDuration, "financial request deadline must not change");
      return AbortSignal.timeout(8);
    },
  };
}

test("stalled canonical WLT GET reaches a deadline and never leaves old agreements visible", async () => {
  for (const controller of [null, new AbortController()]) {
    let requestedSignal;
    const run = runAgreementRead((_url, { signal }) => {
      requestedSignal = signal;
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }, boundedSignalAPI(12_000));
    await assert.rejects(run.read(controller?.signal), error => error?.name === "TimeoutError");
    assert.equal(requestedSignal.aborted, true);
    assert.equal(controller?.signal.aborted ?? false, false,
      "a GET timeout must not revoke the operator session");
    assert.deepEqual(run.agreements, [null],
      "a timed out canonical read never restores an old agreement version");
    assert.deepEqual(run.notices, [""]);
  }
});

test("stalled financial POST becomes uncertain and requires explicit WLT readback, never a second POST", async () => {
  let timedOut = false;
  const run = runProposal({
    signalAPI: boundedSignalAPI(20_000),
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      const fail = () => {
        timedOut = signal.reason?.name === "TimeoutError";
        reject(signal.reason);
      };
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    }),
    read: async () => [agreement],
  });
  await run.operation;
  assert.equal(timedOut, true);
  assert.equal(run.requests.length, 1, "POST is attempted at most once");
  assert.equal(run.reads.length, 1, "only a canonical read follows the uncertain POST");
  assert.equal(run.requests[0][1].signal.aborted, true);
  assert.equal(run.state.confirmation.at(-1), true);
  assert.match(run.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
  assert.deepEqual(run.state.notices, [""], "never report a successful financial mutation on timeout");
  assert.equal(run.state.busy.at(-1), false);
  assert.equal(run.proposalController.current, null);
});

test("stalled commercial Store lookup times out, releases the form and allows safe GET-only retry", async () => {
  let calls = 0;
  const run = runStoreLookup((_url, { signal }) => {
    calls += 1;
    if (calls > 1) return Promise.resolve(storeReply("store-a"));
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, boundedSignalAPI(12_000));
  await run.readStore("store-a");
  assert.equal(calls, 1);
  assert.deepEqual(run.state.selected, [null]);
  assert.match(run.state.errors.at(-1), /انتهت مهلة التحقق من المتجر/);
  assert.equal(run.state.loading.at(-1), false, "timed-out GET must release the disabled form");
  assert.equal(run.activeRead.current, null);
  await run.readStore("store-a");
  assert.equal(calls, 2, "recovery is an operator-initiated read, never an automatic financial POST");
  assert.equal(run.state.selected.at(-1)?.id, "store-a");
  assert.equal(run.state.loading.at(-1), false);
});

test("WLT agreement history rejects malformed consent actors and financial terms before display or new proposal", async () => {
  const invalid = [
    { proposedByActorId: "" },
    { proposedByActorId: null },
    { status: null },
    { reason: null },
    { commercialModel: "UNKNOWN" },
    { commercialModel: null },
    { recurringAmountMinor: "15000" },
    { recurringAmountMinor: 1.5 },
    { recurringAmountMinor: -1 },
    { recurringAmountMinor: 100000001 },
    { billingPeriod: "WEEKLY" },
    { billingTimeZone: "UTC" },
    { invoiceDueDays: "7" },
    { invoiceDueDays: 31 },
    { graceDays: -1 },
    { graceDays: 3.5 },
    { renewalPolicy: "UNKNOWN" },
    { terminationTerms: null },
    { adjustmentTerms: 100 },
  ];
  for (const changed of invalid) {
    const run = runAgreementRead(async () => ({
      ok: true, json: async () => ({ agreements: [{ ...agreement, ...changed }] }),
    }));
    await assert.rejects(run.read(new AbortController().signal), /AGREEMENT_READ_INVALID/,
      "invalid owner ledger field: " + JSON.stringify(changed));
    assert.deepEqual(run.agreements, [null],
      "invalid financial values must not enter actionable UI state");
    assert.deepEqual(run.notices, [""], "no finance confirmation on invalid GET");
  }
});

test("WLT canonical commission, subscription and legacy hybrid agreement fields remain readable", async () => {
  const subscription = {
    ...agreement, commercialModel: "SUBSCRIPTION", recurringAmountMinor: 15000,
    billingPeriod: "MONTHLY", invoiceDueDays: 7, graceDays: 3,
    renewalPolicy: "MANUAL",
    terminationTerms: "Termination terms of store agreement",
    adjustmentTerms: "Adjustment and refund terms of store agreement",
  };
  for (const item of [agreement, subscription, { ...subscription, commercialModel: "HYBRID" }]) {
    const run = runAgreementRead(async () => ({
      ok: true, json: async () => ({ agreements: [item] }),
    }));
    const returned = await run.read(new AbortController().signal);
    assert.equal(returned[0].commercialModel, item.commercialModel);
    assert.equal(returned[0].recurringAmountMinor, item.recurringAmountMinor);
    assert.equal(run.agreements.at(-1)[0].storeId, "store-a");
  }
});

test("WLT history never presents contradictory commission fees or subscription terms as an accepted agreement", async () => {
  const subscription = {
    ...agreement, commercialModel: "SUBSCRIPTION", recurringAmountMinor: 15000,
    billingPeriod: "MONTHLY", invoiceDueDays: 7, graceDays: 3,
    renewalPolicy: "MANUAL",
    terminationTerms: "Commercial termination rules",
    adjustmentTerms: "Commercial adjustment rules",
  };
  const inconsistent = [
    { ...agreement, recurringAmountMinor: 1 },
    { ...agreement, billingPeriod: "MONTHLY" },
    { ...agreement, invoiceDueDays: 1 },
    { ...agreement, graceDays: 1 },
    { ...agreement, renewalPolicy: "AUTOMATIC" },
    { ...agreement, terminationTerms: "unwanted renewal terms" },
    { ...agreement, adjustmentTerms: "unwanted adjustment terms" },
    { ...subscription, recurringAmountMinor: 0 },
    { ...subscription, billingPeriod: "NONE" },
    { ...subscription, renewalPolicy: "NONE" },
    { ...subscription, terminationTerms: "short" },
    { ...subscription, adjustmentTerms: "short" },
    { ...subscription, rates: [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 100 }] },
  ];
  for (const invalid of inconsistent) {
    const run = runAgreementRead(async () => ({
      ok: true, json: async () => ({ agreements: [invalid] }),
    }));
    await assert.rejects(run.read(new AbortController().signal), /AGREEMENT_READ_INVALID/,
      "contractually inconsistent WLT financial row must fail closed");
    assert.deepEqual(run.agreements, [null]);
    assert.deepEqual(run.notices, [""]);
  }
});

test("WLT rate history discloses customer surcharges and store-captain fixed/free/distance delivery terms", async () => {
  const start = proposal.indexOf("function commercialRateDescription(rate: AgreementRate): string {");
  const end = proposal.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start);
  assert.match(proposal, /item\.rates\.map\(commercialRateDescription\)\.join\("، "\)/);
  const formatted = runInNewContext(
    proposal.slice(start, end + 2)
      .replace("rate: AgreementRate", "rate")
      .replace("): string", ")")
      + "\ncommercialRateDescription",
    { labels: {
      BTHWANI_CAPTAIN: "توصيل بثواني",
      PARTNER_CAPTAIN: "توصيل المتجر",
      CUSTOMER_PICKUP: "استلام العميل",
    } },
  );
  const cases = [
    [{ fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: 350 },
      /إضافة على رسوم توصيل العميل: 350 ريال/],
    [{ fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 250,
      deliveryPricingMode: "FIXED", deliveryFixedFeeMinor: 900 },
      /توصيل المتجر: ثابت 900 ريال/],
    [{ fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FREE" },
      /توصيل المتجر: مجاني/],
    [{ fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 100 },
      /توصيل المتجر: حسب المسافة/],
    [{ fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 400 },
      /استلام العميل: 4%/],
  ];
  for (const [rate, message] of cases) {
    const run = runAgreementRead(async () => ({
      ok: true, json: async () => ({ agreements: [{ ...agreement, rates: [rate] }] }),
    }));
    const rows = await run.read(new AbortController().signal);
    assert.equal(rows[0].rates.length, 1);
    assert.match(formatted(rows[0].rates[0]), message);
  }
});

test("malformed WLT delivery markups and captain pricing are never displayed as confirmed agreement terms", async () => {
  const invalid = [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 100, deliveryMarkupMinor: 10 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: 10 },
    { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0, deliveryMarkupMinor: 10 },
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: -1 },
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: 10001 },
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryMarkupMinor: "200" },
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FREE" },
    { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0, deliveryFixedFeeMinor: 100 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "BROKEN" },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FIXED" },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FIXED", deliveryFixedFeeMinor: -1 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FIXED", deliveryFixedFeeMinor: 20001 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "FREE", deliveryFixedFeeMinor: 1 },
    { fulfillmentMode: "PARTNER_CAPTAIN", commissionRateBps: 0, deliveryPricingMode: "DISTANCE", deliveryFixedFeeMinor: 1 },
  ];
  for (const rate of invalid) {
    const run = runAgreementRead(async () => ({
      ok: true, json: async () => ({ agreements: [{ ...agreement, rates: [rate] }] }),
    }));
    await assert.rejects(run.read(new AbortController().signal), /AGREEMENT_READ_INVALID/, JSON.stringify(rate));
    assert.deepEqual(run.agreements, [null]);
    assert.deepEqual(run.notices, [""]);
  }
});

test("proposal verifies consented default delivery fees, never confirming unrequested WLT surcharge", async () => {
  const canonicalFree = { ...agreement, rates: [{
    fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 0,
    deliveryMarkupMinor: 0, deliveryPricingMode: "DISTANCE", deliveryFixedFeeMinor: 0,
  }] };
  const canonicalSurcharge = { ...canonicalFree, rates: [{
    ...canonicalFree.rates[0], deliveryMarkupMinor: 350,
  }] };
  const defaultTerms = runProposal({
    modes: ["BTHWANI_CAPTAIN"],
    fetch: async () => ({ ok: true, json: async () => ({ agreement: canonicalFree }) }),
    read: async () => [canonicalFree],
  });
  await defaultTerms.operation;
  assert.equal(defaultTerms.requests.length, 1);
  assert.equal(defaultTerms.reads.length, 1);
  assert.deepEqual(defaultTerms.state.confirmation, []);
  assert.match(defaultTerms.state.notices.at(-1), /حُفظ اقتراح العمولة/);
  assert.equal(hasOnlyDefaultDeliveryFeeTerms(canonicalFree), true);
  assert.equal(hasOnlyDefaultDeliveryFeeTerms(canonicalSurcharge), false);

  const extraInPost = runProposal({
    modes: ["BTHWANI_CAPTAIN"],
    fetch: async () => ({ ok: true, json: async () => ({ agreement: canonicalSurcharge }) }),
    read: async () => [canonicalSurcharge],
  });
  await extraInPost.operation;
  assert.equal(extraInPost.requests.length, 1);
  assert.equal(extraInPost.reads.length, 1, "after suspicious POST, GET-only recovery");
  assert.equal(extraInPost.state.confirmation.at(-1), true);
  assert.match(extraInPost.state.errors.at(-1), /لم نؤكد نتيجة الاقتراح/);
  assert.equal(extraInPost.state.notices.at(-1), "");

  const extraOnlyInCanonicalGet = runProposal({
    modes: ["BTHWANI_CAPTAIN"],
    fetch: async () => ({ ok: true, json: async () => ({ agreement: canonicalFree }) }),
    read: async () => [canonicalSurcharge],
  });
  await extraOnlyInCanonicalGet.operation;
  assert.equal(extraOnlyInCanonicalGet.requests.length, 1, "never retry POST on canonical mismatch");
  assert.equal(extraOnlyInCanonicalGet.reads.length, 2, "verification and GET-only reconciliation");
  assert.equal(extraOnlyInCanonicalGet.state.confirmation.at(-1), true);
  assert.equal(extraOnlyInCanonicalGet.state.notices.at(-1), "");
});
