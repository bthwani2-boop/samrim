import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("wallet files do not invent a client-side money writer", () => {
  for (const name of ["wallet-screen.tsx","cash-in-panel.tsx","payout-card.tsx","cash-custody.tsx"]) {
    const source=readFileSync(resolve(import.meta.dirname,name),"utf8");
    assert.ok(source.includes("WLT"), name);
    assert.doesNotMatch(source,/fetch\s*\(|localStorage|AsyncStorage|setBalance\s*\(/,name);
  }
});
