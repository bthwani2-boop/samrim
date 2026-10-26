import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const src = readFileSync(new URL("./ui-switch.tsx", import.meta.url), "utf8");
const consent = readFileSync(new URL("../../../../apps/app-client/src/features/account/marketing-contact-preference.tsx", import.meta.url), "utf8");
const barrel = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");

test("Expo UI switch is controlled and inherits the global night/day palette", () => {
  const ast = ts.createSourceFile("ui-switch.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(src, /Host, Switch as UniversalSwitch/);
  assert.match(src, /useMobileAppearance\(\)/);
  assert.match(src, /colorScheme=\{themeName\}/);
  assert.match(src, /seedColor=\{theme\.brandAction\}/);
  assert.match(src, /value=\{value\}/);
  assert.match(src, /onValueChange=\{onValueChange\}/);
  assert.match(src, /disabled=\{disabled\}/);
  assert.match(src, /label=\{label\}/);
  assert.match(barrel, /export \* from "\.\/ui-switch";/);
});

test("marketing consent continues to be backend-confirmed and disabled while unverified", () => {
  assert.match(consent, /<BthwaniUiSwitch/);
  assert.match(consent, /value=\{consent\?\.decision === "OPTED_IN"\}/);
  assert.match(consent, /disabled=\{!consent \|\| pending\}/);
  assert.match(consent, /onValueChange=\{\(next\) => void update\(next\)\}/);
  assert.match(consent, /"Idempotency-Key": Crypto\.randomUUID\(\)/);
  assert.match(consent, /"X-Expected-Version": String\(consent\.version\)/);
  assert.match(consent, /if \(!response\.ok\) throw Error\("CONSENT_UPDATE_FAILED"\)/);
  assert.doesNotMatch(consent, /import \{[^\n]*Switch[^\n]*\} from "react-native"/);
});
