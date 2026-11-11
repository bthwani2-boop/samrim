import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-inventory-summary.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("../src/features/partner-onboarding/partner-performance-reports.tsx", import.meta.url), "utf8");

test("Partner inventory scope distinguishes login sessions of the same owner", () => {
  const first = partnerSetupSessionKey({
    kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: "session-1" },
  });
  const second = partnerSetupSessionKey({
    kind: "authenticated", identity: { role: "partner", subject: "merchant-a", sessionId: "session-2" },
  });
  assert.notEqual(first, second);
  assert.equal(partnerSetupSessionKey({
    kind: "authenticated", identity: { role: "client", subject: "merchant-a", sessionId: "session-1" },
  }), "");
});

test("inventory request and rendering are session-and-Store scoped", () => {
  assert.match(parent, /<PartnerInventorySummary key=\{store\.id\} store=\{store\}/);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession,\s*currentPartnerSessionKey/);
  assert.match(source, /const scopeKey = JSON\.stringify\(\[sessionKey, store\.id\]\)/);
  assert.match(source, /currentPartnerSessionKey\(\) === sessionKey/);
  assert.match(source, /setVisibleScopeKey\(scopeKey\)/);
  assert.match(source, /visibleScopeKey === scopeKey/);
  assert.match(source, /summary\s*&&\s*visible\s*&&\s*!loading\s*&&\s*!error/);
  assert.match(source, /if\s*\(!sessionKey\s*\|\|\s*!base\)/);
});
