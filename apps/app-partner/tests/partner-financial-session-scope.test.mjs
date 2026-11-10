import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const summary = readFileSync(new URL("../src/features/account/partner-financial-summary.tsx", import.meta.url), "utf8");
const activity = readFileSync(new URL("../src/features/wallet/partner-financial-activity.tsx", import.meta.url), "utf8");
const session = (subject, sessionId) => partnerSetupSessionKey({
  kind: "authenticated", identity: { role: "partner", subject, sessionId },
});

test("financial reads are bound to the complete Partner Identity session, not only the subject", () => {
  const original = session("partner-a", "session-1");
  const changedSession = session("partner-a", "session-2");
  const changedActor = session("partner-b", "session-1");
  assert.notEqual(original, changedSession);
  assert.notEqual(original, changedActor);

  for (const [source, name] of [[summary, "summary"], [activity, "activity"]]) {
    assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/, name);
    const guard = source.match(/const stillCurrent = \(\) => [^\n]+;/)?.[0];
    assert.ok(guard, name + " must reject stale work after every await");
    const accepts = (observed, epoch = 1, actualScope = "scope-a") => runInNewContext(
      guard + "\n stillCurrent();",
      {
        sequence: 1, requestID: { current: epoch },
        current: 1, generation: { current: epoch },
        currentPartnerSessionKey: () => observed,
        sessionKey: original, scopeKey: "scope-a", activeScopeKey: { current: actualScope },
      },
    );
    assert.equal(accepts(original), true, name);
    assert.equal(accepts(changedSession), false, name + " same-actor session renewal");
    assert.equal(accepts(changedActor), false, name + " actor change");
    assert.equal(accepts(""), false, name + " logout");
    assert.equal(accepts(original, 2), false, name + " focus/refresh invalidation");
    if (name === "activity") {
      assert.equal(accepts(original, 1, "scope-b"), false, "Store/filter scope changes cancel old requests");
    }
    assert.ok((source.match(/if \(!stillCurrent\(\)\) return;/g) ?? []).length >= 2,
      name + " checks the session both before and after the API read");
  }
});

test("financial summary and paged activity never render stale amounts, rows or details", () => {
  assert.match(summary, /active && readback\?\.sessionKey === sessionKey \? readback\.summary : null/);
  assert.match(summary, /setReadback\(\{ sessionKey, summary: response\.summary \}\)/);
  assert.match(summary, /key=\{JSON\.stringify\(\[sessionKey, summary\.stores\.map/);
  assert.match(activity, /const scopeKey = JSON\.stringify\(\[sessionKey, stores\.map/);
  assert.match(activity, /const visibleItems = visible \? items : \[\]/);
  assert.match(activity, /const visibleCursor = visible \? cursor : ""/);
  assert.match(activity, /const visibleDetail = visible \? detail : null/);
  assert.match(activity, /visible=\{Boolean\(visibleDetail\)\}/);
  assert.match(activity, /const visibleError = errorScopeKey === scopeKey/);
  assert.doesNotMatch(activity.slice(activity.indexOf("  const rows ="), activity.indexOf("function makeStyles")), /\{items\.length\}|\{cursor &&|visible=\{Boolean\(detail\)\}/);
});
