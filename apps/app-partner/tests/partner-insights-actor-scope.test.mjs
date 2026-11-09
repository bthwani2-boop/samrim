import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const file = path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-insights.tsx");
const source = readFileSync(file, "utf8");
const beginning = source.indexOf("  useFocusEffect(useCallback(() => {");
const end = source.indexOf("  const metric =", beginning);
const effect = source.slice(beginning, end);

const session = (actor, id) => partnerSetupSessionKey({
  kind: "authenticated",
  identity: { role: "partner", subject: actor, sessionId: id },
});

test("partner insights rejects stale responses on logout, Store switch, and same-actor session change", () => {
  assert.ok(beginning >= 0 && end > beginning);
  const closure = effect.match(/const stillCurrent = \(\) => \{[\s\S]*?\n    \};/)?.[0];
  assert.ok(closure, "missing live session-and-Store guard");
  const evaluate = (started, observed, active = true, scope = "scope-a") => runInNewContext(
    closure + "\n stillCurrent();",
    { sessionKey: started, currentPartnerSessionKey: () => observed,
      active, activeScopeKey: { current: scope }, storeScopeKey: "scope-a" },
  );
  const first = session("partner-a", "session-1");
  const second = session("partner-a", "session-2");
  assert.equal(evaluate(first, first), true);
  assert.equal(evaluate(first, second), false, "a different session of the same actor must not commit");
  assert.equal(evaluate(first, session("partner-b", "session-1")), false);
  assert.equal(evaluate(first, ""), false, "logout invalidates the read");
  assert.equal(evaluate(first, first, false), false, "blur/unmount invalidates the read");
  assert.equal(evaluate(first, first, true, "scope-b"), false, "Store switch invalidates the read");
  assert.equal(evaluate("", first), false, "missing initiating session is not authorized");
});

test("partner insights prevents flash of previous session metrics and guards every response", () => {
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey/);
  assert.match(source, /const storeScopeKey = JSON\.stringify\(\[sessionKey, selectedStore\?\.id \?\? ""\]\)/);
  assert.match(source, /visibleScopeKey === storeScopeKey \? storedSnapshot : blank/);
  assert.match(effect, /setSnapshot\(blank\);\s*setVisibleScopeKey\(""\);|setSnapshot\(blank\);\s*setVisibleScopeKey\(" "\);/);
  assert.match(effect, /const token = await getUsableIdentityAccessToken\(\);\s*if \(!stillCurrent\(\)\) return;\s*const \[orderResult/);
  assert.match(effect, /await Promise\.allSettled\([\s\S]*?\]\);\s*if \(!stillCurrent\(\)\) return;\s*const o/);
  assert.match(effect, /setSnapshot\(\{[\s\S]*?\}\);\s*setVisibleScopeKey\(storeScopeKey\);/);
});
