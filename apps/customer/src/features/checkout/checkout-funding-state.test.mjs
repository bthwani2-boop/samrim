import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { alignCheckoutFunding } from "./checkout-funding-state.ts";

const evidence = {
  kind: "ready",
  balance: { actorId: "customer-a", currency: "YER", balanceYer: "9007199254740993", availableYer: "9007199254740992" },
  expiresAt: 20000,
};

test("checkout WLT evidence stays read-only and belongs to the current DSH cart actor", () => {
  assert.deepEqual(alignCheckoutFunding("customer-a", evidence, 10000), evidence);
  assert.deepEqual(alignCheckoutFunding("customer-b", evidence, 10000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("", evidence, 10000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", evidence, 20000), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", { ...evidence, expiresAt: Number.NaN }, 10000),
    { kind: "signed-out" });
});

test("checkout funding rejects unavailable or revoked WLT read without fallback", () => {
  assert.deepEqual(alignCheckoutFunding("customer-a", { kind: "signed-out" }), { kind: "signed-out" });
  assert.deepEqual(alignCheckoutFunding("customer-a", { kind: "unavailable" }), { kind: "unavailable" });
});

test("checkout web and native adapters reuse existing verified WLT reader, not a financial writer", () => {
  for (const name of ["checkout-funding.web.ts", "checkout-funding.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.match(source, /alignCheckoutFunding\(cartActorId, result\)/);
    assert.match(source, /signal\.throwIfAborted\(\)/);
    assert.doesNotMatch(source, /fetch\(|writeWallet|charge\(|createOrder\(/);
  }
  assert.match(readFileSync(new URL("./checkout-funding.web.ts", import.meta.url), "utf8"),
    /readVerifiedWallet\(readCustomerAdmission, signal, cartActorId\)/);
  assert.match(readFileSync(new URL("./checkout-funding.ts", import.meta.url), "utf8"),
    /readNativeWallet\(signal, cartActorId\)/);
});

const adapters = ["checkout-funding.ts", "checkout-funding.web.ts"].map(name => ({
  name, source: fileURLToPath(new URL(name, import.meta.url)),
}));
const repo = fileURLToPath(new URL("../../../../..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "bthwani-funding-adapters-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    join(repo, "node_modules/@typescript/native/bin/tsc"), ...adapters.map(adapter => adapter.source),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--inlineSourceMap", "--inlineSources", "--outDir", scratch,
  ], { cwd: repo, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = Object.fromEntries(adapters.map(({ name }) => [
    name, readFileSync(join(scratch, name.replace(/\.ts$/, ".js")), "utf8"),
  ]));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const loaded = [];
process.once("exit", () => loaded.length);

function adapterHarness({ name, source }, ownerRead) {
  const calls = [];
  const admission = () => assert.fail("adapter must pass the admission reader to the existing verified wallet reader");
  const mocks = {
    "./checkout-funding-state": { alignCheckoutFunding },
  };
  const web = name.endsWith(".web.ts");
  if (web) {
    mocks["../access/customer-session-transport"] = { readCustomerAdmission: admission };
    mocks["../wallet/wallet-read.web"] = {
      readVerifiedWallet(reader, signal, actorId) {
        assert.equal(reader, admission);
        calls.push({ signal, actorId });
        return ownerRead();
      },
    };
  } else {
    mocks["../wallet/wallet-read"] = {
      readNativeWallet(signal, actorId) {
        calls.push({ signal, actorId });
        return ownerRead();
      },
    };
  }
  const module = loadMappedRenderFixture(compiled[name], source, mocks);
  loaded.push(module);
  return { read: module.exports.readCheckoutFunding, calls };
}

for (const adapter of adapters) {
  test(`${adapter.name} aligns wallet evidence with the current cart and rejects stale or unavailable reads`, async () => {
    const valid = { ...evidence, expiresAt: Date.now() + 60000 };
    const cases = [
      [valid, valid],
      [{ ...valid, balance: { ...valid.balance, actorId: "customer-b" } }, { kind: "signed-out" }],
      [{ ...valid, expiresAt: 1 }, { kind: "signed-out" }],
      [{ kind: "unavailable" }, { kind: "unavailable" }],
      [{ kind: "signed-out" }, { kind: "signed-out" }],
    ];
    for (const [value, expected] of cases) {
      const h = adapterHarness(adapter, async () => value);
      const controller = new AbortController();
      assert.deepEqual(await h.read("customer-a", controller.signal), expected);
      assert.deepEqual(h.calls, [{ signal: controller.signal, actorId: "customer-a" }]);
    }
  });

  test(`${adapter.name} rejects a late wallet response after checkout cancellation`, async () => {
    let resolve;
    const h = adapterHarness(adapter, () => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const pending = h.read("customer-a", controller.signal);
    assert.deepEqual(h.calls, [{ signal: controller.signal, actorId: "customer-a" }]);
    controller.abort();
    resolve({ ...evidence, expiresAt: Date.now() + 60000 });
    await assert.rejects(pending, { name: "AbortError" });
  });
}
