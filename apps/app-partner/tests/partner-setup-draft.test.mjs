import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";
import { readPartnerSetupDraft, rememberPartnerSetupDraft, clearPartnerSetupDraft } from "../src/features/partner-onboarding/partner-setup-draft.ts";

const session = (subject, sessionId) =>
  partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject, sessionId } });

const draft = {
  step: 3, name: "متجر اختباري", relation: "INDEPENDENT_STORE",
  address: "عنوان تجريبي", city: "city-1", vertical: "groceries",
  storeType: "type-1", modes: ["CUSTOMER_PICKUP"], lat: "15.3", lng: "44.2",
};

test("draft restores the same actor/session steps and survives remount-style reads", () => {
  const scope = session("actor-a", "session-a");
  rememberPartnerSetupDraft(scope, draft);
  assert.deepEqual(readPartnerSetupDraft(scope), draft);
  assert.deepEqual(readPartnerSetupDraft(scope), draft);
  clearPartnerSetupDraft(scope);
  assert.equal(readPartnerSetupDraft(scope), null);
});

test("Identity session change drops previous store setup without leaking to another actor", () => {
  const scopeA = session("actor-a", "session-a");
  const scopeB = session("actor-b", "session-a");
  rememberPartnerSetupDraft(scopeA, draft);
  assert.equal(readPartnerSetupDraft(scopeB), null);
  assert.equal(readPartnerSetupDraft(scopeA), null);
  rememberPartnerSetupDraft(scopeA, draft);
  assert.equal(readPartnerSetupDraft(session("actor-a", "session-b")), null);
  assert.equal(readPartnerSetupDraft(scopeA), null);
});

test("draft mutation cannot modify saved modes, and empty Identity scope stores nothing", () => {
  const scope = session("actor-c", "session-c");
  const source = { ...draft, modes: ["PARTNER_CAPTAIN"] };
  rememberPartnerSetupDraft(scope, source);
  source.modes.push("BTHWANI_CAPTAIN");
  const restored = readPartnerSetupDraft(scope);
  assert.deepEqual(restored?.modes, ["PARTNER_CAPTAIN"]);
  restored.modes.push("BTHWANI_CAPTAIN");
  assert.deepEqual(readPartnerSetupDraft(scope)?.modes, ["PARTNER_CAPTAIN"]);
  clearPartnerSetupDraft(scope);
  rememberPartnerSetupDraft("", draft);
  assert.equal(readPartnerSetupDraft(""), null);
});
