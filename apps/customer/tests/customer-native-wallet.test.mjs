import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/wallet/wallet-read.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = {readNativeWallet, readNativeWalletTransactions};";

class ReadError extends Error {
  constructor(status) { super("read failed"); this.status = status; }
}
function harness({ preview = "1", origin = "http://10.0.2.2:23203", platform = "android",
  proofKind = "ready", error } = {}) {
  const requests = [];
  let proofs = 0;
  const bearer = "opaque-test-session";
  const mocks = {
    "@bthwani/wlt": {
      WltReadError: ReadError,
      async readCurrentCustomerWallet(source, token, signal) {
        requests.push({ kind: "wallet", source, token, signal });
        if (error) throw new ReadError(error);
        return { actorId: "actor-a", currency: "YER", balanceYer: "9007199254740993", availableYer: "9007199254740992" };
      },
      async readCurrentCustomerWalletTransactions(source, token, signal, cursor) {
        requests.push({ kind: "history", source, token, signal, cursor });
        if (error) throw new ReadError(error);
        return { actorId: "actor-a", currency: "YER", items: [], hasMore: false, nextCursor: null };
      },
    },
    "react-native": { Platform: { OS: platform } },
    "../access/customer-session-transport": {
      async withVerifiedNativeCustomerRead(signal, readOwner, expectedActorId) {
        proofs++;
        if (proofKind !== "ready") return { kind: proofKind };
        if (expectedActorId !== undefined && expectedActorId !== "actor-a") return { kind: "signed-out" };
        const value = await readOwner(bearer);
        return { kind: "ready", value, expiresAt: Date.now() + 60000 };
      },
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected import ${name}`);
      return mocks[name];
    }, mod, mod.exports,
    { env: { EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW: preview,
      EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN: origin } },
  );
  return { ...mod.exports, requests, proofs: () => proofs };
}

test("Android wallet stays closed before Identity when isolated WLT host proof is missing", async () => {
  for (const config of [
    { preview: "0" }, { platform: "ios" }, { origin: "" },
    { origin: "http://127.0.0.1:23203" }, { origin: "http://attacker.invalid:23203" },
    { origin: "https://10.0.2.2:23203" }, { origin: "http://10.0.2.2:23203/path" },
    { origin: "http://10.0.2.2:70000" },
  ]) {
    const h = harness(config);
    assert.deepEqual(await h.readNativeWallet(new AbortController().signal),
      { kind: "unavailable" }, JSON.stringify(config));
    assert.deepEqual(h.requests, [], JSON.stringify(config));
    assert.equal(h.proofs(), 0, JSON.stringify(config));
  }
});

test("Native read-only owner transport reads exact YER from the validated Customer session", async () => {
  const h = harness();
  const signal = new AbortController().signal;
  const result = await h.readNativeWallet(signal);
  assert.equal(result.kind, "ready");
  assert.equal(result.balance.balanceYer, "9007199254740993");
  assert.ok(result.expiresAt > Date.now());
  assert.deepEqual(h.requests, [{
    kind: "wallet", source: "http://10.0.2.2:23203",
    token: "opaque-test-session", signal,
  }]);
  assert.equal(h.proofs(), 1);
});

test("Native checkout balance refuses a different verified actor before WLT dispatch", async () => {
  const h = harness();
  const signal = new AbortController().signal;
  assert.deepEqual(await h.readNativeWallet(signal, "actor-b"), { kind: "signed-out" });
  assert.deepEqual(h.requests, []);
  assert.equal(h.proofs(), 1);
  assert.equal((await h.readNativeWallet(signal, "actor-a")).kind, "ready");
  assert.equal(h.requests.length, 1);
});

test("Native funding history forwards only the continuation to WLT, never caller actor ID", async () => {
  const h = harness();
  const signal = new AbortController().signal;
  const cursor = "safe-cursor-ABCDEFGHIJKLMNOP";
  const result = await h.readNativeWalletTransactions(signal, cursor);
  assert.equal(result.kind, "ready");
  assert.equal(result.history.actorId, "actor-a");
  assert.deepEqual(h.requests, [{
    kind: "history", source: "http://10.0.2.2:23203",
    token: "opaque-test-session", signal, cursor,
  }]);
});

test("Native finance denies stale admission and owner revocation without returning money", async () => {
  for (const proofKind of ["signed-out", "unavailable"]) {
    const h = harness({ proofKind });
    assert.deepEqual(await h.readNativeWallet(new AbortController().signal),
      { kind: proofKind });
    assert.deepEqual(h.requests, []);
  }
  for (const [error, kind] of [[401, "signed-out"], [403, "signed-out"],
    [503, "unavailable"]]) {
    const h = harness({ error });
    assert.deepEqual(await h.readNativeWallet(new AbortController().signal), { kind });
  }
});

test("Native wallet hides transport failures and does not reinterpret an aborted request as an available balance", async () => {
  const h = harness({ error: 502 });
  assert.deepEqual(await h.readNativeWallet(new AbortController().signal),
    { kind: "unavailable" });
});
