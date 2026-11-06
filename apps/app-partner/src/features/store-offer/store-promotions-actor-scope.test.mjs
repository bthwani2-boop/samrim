import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "store-promotions.tsx"), "utf8");

test("partner promotion response is rejected after logout, actor change or a superseding read", () => {
  const closure = source.match(/const stillCurrent = \(\) => \{[\s\S]*?\n    \};/)?.[0];
  assert.ok(closure, "the async read must check the current identity and request generation");
  const current = (started, latestActor, issued = 4, newest = 4) => runInNewContext(
    closure + "\n stillCurrent();",
    {
      actorID: started,
      readID: issued,
      latestRead: { current: newest },
      currentIdentityState: () => latestActor
        ? { kind: "authenticated", identity: { subject: latestActor } }
        : { kind: "unauthenticated" },
    },
  );
  assert.equal(current("partner-one", "partner-one"), true);
  assert.equal(current("partner-one", "partner-two"), false, "response from a previous account is stale");
  assert.equal(current("partner-one", null), false, "logout invalidates an in-flight response");
  assert.equal(current("partner-one", "partner-one", 3, 4), false, "newer read supersedes an old response");
  assert.equal(current("", "partner-one"), false, "missing actor cannot own an authenticated read");
});

test("partner promotions and campaigns are visible only for the initiating actor and Store", () => {
  const logic = source.match(/const scopeMatches = [^\n]+;\n  const state = [^\n]+;\n  const campaigns = [^\n]+;/)?.[0];
  assert.ok(logic, "the UI must scope cached promotions before rendering");
  const readback = {
    actorID: "partner-one", storeID: "store-one",
    promotions: { promotions: [{ id: "only-partner-one" }] },
    campaigns: { campaigns: [{ promotion: { id: "only-store-one" } }] },
  };
  const visible = (actorID, storeID) => runInNewContext(
    logic + "\n ({ state, campaigns });", { actorID, storeID, readback },
  );
  assert.equal(visible("partner-one", "store-one").state, readback.promotions);
  assert.equal(visible("partner-one", "store-one").campaigns, readback.campaigns);
  assert.equal(visible("partner-two", "store-one").state, null);
  assert.equal(visible("partner-one", "store-two").campaigns, null);
  assert.equal(visible("", "store-one").state, null);
});

test("every async settlement of the promotion read checks current identity before UI mutation", () => {
  const loader = source.slice(source.indexOf("  const load = useCallback("), source.indexOf("  useEffect(() => {", source.indexOf("  const load = useCallback(")));
  assert.match(loader, /const token = await getUsableIdentityAccessToken\(\);\s*if \(!stillCurrent\(\)\) return null;/);
  assert.match(loader, /await Promise\.allSettled\([\s\S]+?\]\);\s*if \(!stillCurrent\(\)\) return null;/);
  assert.match(loader, /catch \(cause\) \{\s*if \(!stillCurrent\(\)\) return null;/);
  assert.match(source, /return \(\) => \{ latestRead\.current\+\+; \};/);
});
