import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-catalog-activity.tsx", import.meta.url), "utf8");
const session = id => partnerSetupSessionKey({ kind: "authenticated", identity: {
  role: "partner", subject: "same-partner", sessionId: id,
} });

test("catalog activity pagination and audit details remount for each Store and login session", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /key=\{JSON\.stringify\(\[sessionKey, scope\.selectedStore\?\.id \?\? ""\]\)\}/);
  assert.match(source, /const scopeKey = JSON\.stringify\(\[sessionKey, storeID\]\)/);
  assert.match(source, /const page = visible && read\.kind === "ready" \? read\.page : null/);
  assert.match(source, /selectedStore && allowed && Boolean\(sessionKey\) && currentPartnerSessionKey\(\) === sessionKey \? <>/);
});

test("catalog audit rejects stale reads from old Store or same-actor session", () => {
  const closure = source.match(/const current = \(\) => \{[\s\S]*?\n    \};/)?.[0];
  assert.ok(closure, "readback completion must validate the current session and Store");
  const first = session("s1");
  const second = session("s2");
  const verify = (observed, key = "store-a", active = true) => runInNewContext(
    closure + "\n current();",
    { sessionKey: first, currentPartnerSessionKey: () => observed,
      activeScopeKey: { current: key }, scopeKey: "store-a", active },
  );
  assert.equal(verify(first), true);
  assert.equal(verify(second), false);
  assert.equal(verify("", "store-a"), false);
  assert.equal(verify(first, "store-b"), false);
  assert.equal(verify(first, "store-a", false), false);
});
