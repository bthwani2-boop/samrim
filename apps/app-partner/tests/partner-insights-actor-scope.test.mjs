import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const file = path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-insights.tsx");
const source = readFileSync(file, "utf8");
const beginning = source.indexOf("  useFocusEffect(useCallback(() => {");
const end = source.indexOf("  const metric =", beginning);
const effect = source.slice(beginning, end);

test("partner insights reads remain bound to the initiating authenticated actor", () => {
  assert.ok(beginning >= 0 && end > beginning);
  const closure = effect.match(/const stillCurrent = \(\) => \{[\s\S]*?\n    \};/)?.[0];
  assert.ok(closure, "missing live-identity guard");
  const evaluate = (started, observed, active = true) => runInNewContext(
    closure + "\n stillCurrent();",
    { actorID: started, active, currentIdentityState: () => observed
      ? { kind: "authenticated", identity: { subject: observed } }
      : { kind: "unauthenticated" } },
  );
  assert.equal(evaluate("partner-a", "partner-a"), true);
  assert.equal(evaluate("partner-a", "partner-b"), false, "old account response must not be committed");
  assert.equal(evaluate("partner-a", null), false, "logout invalidates the read");
  assert.equal(evaluate("partner-a", "partner-a", false), false, "blur/unmount invalidates the read");
  assert.equal(evaluate("", "partner-a"), false, "missing initiating actor is not authorized");
});

test("partner insights guards token acquisition, financial readback and rejection state", () => {
  assert.match(effect, /const actorID = identity\.kind === "authenticated"/);
  assert.match(effect, /if \(!actorID\) \{ setLoading\(false\); return \(\) => \{ active = false; \}; \}/);
  assert.match(effect, /const token = await getUsableIdentityAccessToken\(\);\s*if \(!stillCurrent\(\)\) return;\s*const \[orderResult/);
  assert.match(effect, /await Promise\.allSettled\([\s\S]*?\]\);\s*if \(!stillCurrent\(\)\) return;\s*const o/);
  assert.match(effect, /void read\(\)\.catch\(\(\) => \{ if \(stillCurrent\(\)\) setLoading\(false\); \}\);/);
});
