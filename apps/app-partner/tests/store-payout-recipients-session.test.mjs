import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/wallet/store-payout-recipients-card.tsx", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/features/wallet/wallet.tsx", import.meta.url), "utf8");

function operation(name, context) {
  const snippet = source.match(new RegExp(`  const ${name} = async \\([^\\n]*\\) => \\{[\\s\\S]*?\\n  \\};`))?.[0];
  assert.ok(snippet, `${name} must remain a single owner-backed financial operation`);
  const js = snippet.replace(/ = async \(choice: [^\n]+\) => \{/, " = async (choice) => {");
  return runInNewContext(js + `\n${name};`, context);
}

function context(overrides = {}) {
  const writes = [];
  const log = (kind) => (...values) => writes.push({ kind, values });
  const instance = {
    stillCurrent: () => true,
    setBusyStoreId: log("busy"),
    setError: log("error"),
    setNotice: log("notice"),
    setPickerStoreId: log("picker"),
    setConfirmation: log("confirmation"),
    setState: log("state"),
    readEpoch: { current: 0 },
    Crypto: { randomUUID: () => "test-uuid" },
    console: { error: log("log") },
    getUsableIdentityAccessToken: async () => "original-token",
    client: () => ({
      selectPartnerStorePayoutRecipient: () => Promise.resolve({ assignment: { beneficiaryActorId: "employee-a" } }),
      revertPartnerStorePayoutRecipient: async () => ({}),
      listPartnerStorePayoutRecipients: async () => ({ readback: { recipients: [{ storeId: "store-a", state: "DEFAULT_OWNER" }] } }),
    }),
    ...overrides,
  };
  return { instance, writes };
}

const choice = { storeId: "store-a", grantId: "grant-a", storeName: "Store A", beneficiaryName: "Employee A" };

test("recipient card is remounted on full Partner session changes and never reuses actor-only UI state", () => {
  assert.match(wallet, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/);
  assert.match(wallet, /<StorePayoutRecipientsCard key=\{"recipients:" \+ sessionKey \+ ":" \+ ownerScopeKey\}/);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/);
  assert.match(source, /Boolean\(sessionKey\) && currentPartnerSessionKey\(\) === sessionKey/);
  assert.match(source, /if \(!stillCurrent\(\)\) return;\s*const next = await client\(\)\.listPartnerStorePayoutRecipients\(token\)/);
});

for (const name of ["select", "revert"]) {
  test(`${name}: session switch before acquiring a token prevents recipient mutation`, async () => {
    let completeToken;
    let active = true;
    let mutationCount = 0;
    const token = new Promise((resolve) => { completeToken = resolve; });
    const { instance } = context({
      stillCurrent: () => active,
      getUsableIdentityAccessToken: () => token,
      client: () => ({
        selectPartnerStorePayoutRecipient: async () => { mutationCount++; return {}; },
        revertPartnerStorePayoutRecipient: async () => { mutationCount++; return {}; },
      }),
    });
    const pending = operation(name, instance)(choice);
    active = false;
    completeToken("new-actor-token");
    await pending;
    assert.equal(mutationCount, 0, "a renewed actor token must not execute an old session's mutation");
  });

  test(`${name}: session switch while mutation is in flight prevents stale readback or success UI`, async () => {
    let active = true;
    let finishMutation;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    let readbacks = 0;
    const mutation = () => { markStarted(); return new Promise((resolve) => { finishMutation = resolve; }); };
    const { instance, writes } = context({
      stillCurrent: () => active,
      client: () => ({
        selectPartnerStorePayoutRecipient: mutation,
        revertPartnerStorePayoutRecipient: mutation,
        listPartnerStorePayoutRecipients: async () => { readbacks++; return { readback: { recipients: [] } }; },
      }),
    });
    const pending = operation(name, instance)(choice);
    await started;
    active = false;
    finishMutation({ assignment: { beneficiaryActorId: "employee-a" } });
    await pending;
    assert.equal(readbacks, 0, "old session must not chain into another canonical readback");
    assert.equal(writes.filter((write) => write.kind === "notice").length, 1, "only the initial clear notice may occur");
    assert.equal(writes.filter((write) => write.kind === "state").length, 0, "no stale canonical data is displayed");
  });
}
