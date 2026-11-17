import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("wallet and cash-in remain blocked without WLT owner-backed balances", () => {
  for (const file of ["wallet-screen.tsx", "cash-in-panel.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /CapabilityUnavailableScreen/);
    assert.doesNotMatch(source, /fetch\(|credit\(|debit\(/);
  }
});
