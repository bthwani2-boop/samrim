import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { operatorRecoveryStorageKey } from "../src/features/finance/operator-recovery-key.ts";

const root = new URL("../", import.meta.url);
const cash = readFileSync(new URL("src/features/finance/cash-custody-workspace.tsx", root), "utf8");
const earnings = readFileSync(new URL("src/features/finance/partner-earnings-workspace.tsx", root), "utf8");
const layout = readFileSync(new URL("app/(workspace)/layout.tsx", root), "utf8");

test("finance recovery keys are operator-scoped and are not shared across accounts", () => {
  const base = "bthwani.finance.cash-custody.recovery.v1";
  assert.equal(operatorRecoveryStorageKey(base, ""), null);
  assert.equal(operatorRecoveryStorageKey(base, " "), null);
  const a = operatorRecoveryStorageKey(base, "operator-a");
  const b = operatorRecoveryStorageKey(base, "operator-b");
  assert.ok(a?.startsWith(base + ":"));
  assert.ok(b?.startsWith(base + ":"));
  assert.notEqual(a, b);
  assert.notEqual(a, base);
  assert.equal(operatorRecoveryStorageKey(base, " operator/b "), base + ":operator%2Fb");
});

test("all finance recovery reads and writes require the authenticated operator", () => {
  for (const source of [cash, earnings]) {
    assert.match(source, /useSession\(\)/);
    assert.match(source, /operatorSession\.kind === "authenticated" \? operatorSession\.identity\.subject\.trim\(\) : ""/);
    assert.match(source, /operatorRecoveryStorageKey\(/);
    assert.doesNotMatch(source, /sessionStorage\.getItem\(cashCustodyRecoveryKey\)|sessionStorage\.getItem\(partnerRemittanceRecoveryKey\)/);
    assert.doesNotMatch(source, /sessionStorage\.setItem\(cashCustodyRecoveryKey|sessionStorage\.setItem\(partnerRemittanceRecoveryKey/);
    assert.match(source, /if \(!key\) return/);
    assert.match(source, /\[operatorActorId\]/);
  }
});

test("workspace actor switches discard React subtree state without clearing durable idempotency records", () => {
  assert.match(layout, /<main key=\{state\.identity\.subject\}/);
  assert.match(cash, /idempotencyKey|evidenceKey/);
  assert.match(earnings, /idempotencyKey/);
  assert.doesNotMatch(cash + earnings, /sessionStorage\.clear\(\)/);
});

test("an old unscoped financial attempt is never adopted as a new operator's record", () => {
  const base = "bthwani.finance.partner-remittance.recovery.v1";
  const oldKey = base;
  const keyA = operatorRecoveryStorageKey(base, "operator-a");
  const keyB = operatorRecoveryStorageKey(base, "operator-b");
  const records = new Map([[oldKey, "legacy-untrusted"], [keyA, "operator-a"]]);
  assert.equal(records.get(keyB), undefined);
  assert.equal(records.get(keyA), "operator-a");
  assert.notEqual(records.get(oldKey), records.get(keyA));
  assert.match(cash, /readCashCustodyRecovery\(operatorActorId\)/);
  assert.match(earnings, /readPartnerRemittanceRecovery\(operatorActorId\)/);
});
