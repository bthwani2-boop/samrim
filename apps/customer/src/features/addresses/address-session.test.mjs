import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("address screens retain fail-closed behavior until Identity and DSH are integrated", () => {
  for (const file of ["addresses-screen.tsx", "address-editor.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /CapabilityUnavailableScreen/);
    assert.doesNotMatch(source, /fetch\(|AsyncStorage|SecureStore|createAddress\(/);
  }
});
