import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const gate = readFileSync(new URL("../src/features/access/identity-gate.tsx", import.meta.url), "utf8");
const identity = readFileSync(new URL("../src/bootstrap/identity.ts", import.meta.url), "utf8");

test("client login offers password recovery before any failed credential attempt", () => {
  assert.match(gate, /\{mode === "login" \? \(\s*<BthwaniButton[^>]*label=\{copy\.forgotPassword\}[^>]*onPress=\{\(\) => selectMode\("recover"\)\}/u);
  assert.doesNotMatch(gate, /\bloginFailed\b|\bisCredentialFailure\b/u);
});

test("recover mode retains the entered phone and uses canonical Identity proof", () => {
  const modeTransition = gate.match(/const selectMode = useCallback\(\(next: AuthMode\) => \{([\s\S]*?)\}, \[\]\);/u);
  assert.ok(modeTransition);
  assert.doesNotMatch(modeTransition[1], /setPhone\(/u);
  assert.match(gate, /await requestClientRecovery\(phone\)/u);
  assert.match(gate, /await recoverClient\(phone, code, password\)/u);
  assert.match(identity, /requestClientRecovery\(\{ phone \}\)/u);
  assert.match(identity, /runtime\.identityClient\(\)\.recoverClient\(/u);
});
