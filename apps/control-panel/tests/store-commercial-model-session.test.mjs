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

function runStoreLookup(fetch) {
  const sequence = { current: 0 };
  const activeRead = { current: null };
  const state = { selected: [], errors: [], loading: [] };
  const readStore = runInNewContext(lookupCode + "\nreadStore", {
    useCallback: callback => callback,
    sequence, activeRead, AbortController, encodeURIComponent,
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

function runProposal({ fetch, headers, read, existingError = "", requiringConfirmation = false } = {}) {
  const proposalController = { current: null };
  const state = { busy: [], errors: [], notices: [], agreements: [], confirmation: [] };
  const requests = [];
  const reads = [];
  const trigger = runInNewContext(proposeCode + "\n({ operation: propose(), repeat: propose })", {
    readOnly: false, busy: false, error: existingError, requiresConfirmation: requiringConfirmation, actorId: "operator-a", nextProposalVersion: 0,
    modes: ["CUSTOMER_PICKUP"], labels: { CUSTOMER_PICKUP: "استلام العميل" },
    commercialModel: "COMMISSION", commissionPercentByMode: { CUSTOMER_PICKUP: "0" },
    recurringAmount: "", billingPeriod: "MONTHLY", invoiceDueDays: "7",
    graceDays: "3", renewalPolicy: "MANUAL", terminationTerms: "", adjustmentTerms: "",
    proposalReason: agreement.reason,
    storeId: "store-a", url: "/api/partners/stores/store-a/commercial-agreements",
    proposalController, AbortController,
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
    matchesProposedStoreAgreement,
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
  assert.strictEqual(run.reads[0][0], run.requests[0][1].signal);
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

function runAgreementRead(fetch) {
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
    useCallback: callback => callback, readSequence,
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
