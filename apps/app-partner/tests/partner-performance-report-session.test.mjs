import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-performance-reports.tsx", import.meta.url), "utf8");
const session = (actor, id) => partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: actor, sessionId: id } });

test("Partner reports reject stale data and CSV exports across sessions and Stores", () => {
  const guards = [...source.matchAll(/const (?:stillCurrent|isCurrent) = \(\) => \{[\s\S]*?\n    \};/g)].map(match => match[0]);
  assert.equal(guards.length, 3, "list, summary and full-export must independently guard their asynchronous work");
  const first = session("partner-a", "session-1");
  const second = session("partner-a", "session-2");
  const verify = (guard, observed, activeScope = "scope-a", active = true) =>
    runInNewContext(guard + "\n " + (guard.includes("stillCurrent") ? "stillCurrent()" : "isCurrent()") + ";",
      { sessionKey: first, currentPartnerSessionKey: () => observed,
        activeScopeKey: { current: activeScope }, scopeKey: "scope-a", active,
        exportEpoch: { current: 1 }, startedExportEpoch: 1 });
  for (const guard of guards) {
    assert.equal(verify(guard, first), true);
    assert.equal(verify(guard, second), false, "a new login of the same partner invalidates prior results");
    assert.equal(verify(guard, session("partner-b", "session-1")), false);
    assert.equal(verify(guard, ""), false, "logout invalidates results");
    assert.equal(verify(guard, first, "scope-b"), false, "Store or report changes invalidate results");
  }
  for (const guard of guards.slice(0, 2)) assert.equal(verify(guard, first, "scope-a", false), false);
  const exportGuard = guards[2];
  assert.equal(runInNewContext(exportGuard + "\n isCurrent();", {
    sessionKey: first, currentPartnerSessionKey: () => first,
    activeScopeKey: { current: "scope-a" }, scopeKey: "scope-a",
    exportEpoch: { current: 3 }, startedExportEpoch: 1,
  }), false, "returning to Store A after visiting B must not revive A's previous CSV export");
});

test("old report rows, summary and CSV controls are hidden before new scope is read", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /const scopeKey = JSON\.stringify\(\[sessionKey, store\.id, view\]\)/);
  assert.match(source, /exportEpoch\.current \+= 1;\s*return \(\) => \{ exportEpoch\.current \+= 1; \};/);
  assert.match(source, /const visible = allowed && Boolean\(sessionKey\) && currentPartnerSessionKey\(\) === sessionKey && visibleScopeKey === scopeKey/);
  assert.match(source, /const orders = visible \? storedOrders : \[\]/);
  assert.match(source, /const offers = visible \? storedOffers : \[\]/);
  assert.match(source, /const orderSummary = visible && visibleSummaryScopeKey === scopeKey \? storedOrderSummary : null/);
  assert.match(source, /const copyReport = \(\) => \{\s*if \(!visible \|\| loading \|\| error\) return;/);
  assert.match(source, /if \(!stillCurrent\(\)\) return;\s*if \(view === "orders"\)/);
  assert.match(source, /if \(!stillCurrent\(\)\) return;\s*const response = await api\.readPartnerStoreOrderSummary/);
});
