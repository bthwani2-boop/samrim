import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const consent = readFileSync(new URL("../../../../apps/app-client/src/features/account/marketing-contact-preference.tsx", import.meta.url), "utf8");
const barrel = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");

test("Expo UI switch is used directly with the shared night/day appearance", () => {
  const ast = ts.createSourceFile("marketing-contact-preference.tsx", consent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(consent, /import \{ Host, Switch \} from "@expo\/ui"/);
  assert.match(consent, /useMobileAppearance\(\)/);
  assert.match(consent, /colorScheme=\{themeName\}/);
  assert.match(consent, /seedColor=\{theme\.brandAction\}/);
  assert.match(consent, /const currentConsent = isCurrentMarketingConsentActor\(active, actorID, currentIdentityState\(\)\) \? consent : null/);
  assert.match(consent, /value=\{currentConsent\?\.decision === "OPTED_IN"\}/);
  assert.match(consent, /disabled=\{!currentConsent \|\| pending\}/);
  assert.match(consent, /onValueChange=\{\(next\) => void update\(next\)\}/);
  assert.match(consent, /label="السماح بتنبيهات العروض"/);
  assert.doesNotMatch(barrel, /export \* from "\.\/ui-switch";/);
});

test("marketing consent remains backend-confirmed and disabled while unverified", () => {
  assert.match(consent, /"Idempotency-Key": Crypto\.randomUUID\(\)/);
  assert.match(consent, /"X-Expected-Version": String\(consent\.version\)/);
  assert.match(consent, /if \(!response\.ok\) throw Error\("CONSENT_UPDATE_FAILED"\)/);
  assert.match(consent, /data\.version <= consent\.version/);
  assert.match(consent, /setConsent\(\{ channel: "PUSH", decision: data\.decision, version: data\.version \}\)/);
  assert.doesNotMatch(consent, /import \{[^\n]*Switch[^\n]*\} from "react-native"/);
});
