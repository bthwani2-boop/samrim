import assert from "node:assert/strict";
import test from "node:test";

test("a network error must clear previously shown opportunity circles", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./captain-opportunities.tsx", import.meta.url), "utf8");
  const refreshCatch = source.match(/\} catch \{([\s\S]*?)\} finally \{/);
  assert.ok(refreshCatch, "the refresh failure handler must exist");
  assert.match(refreshCatch[1], /setData\(null\);\s*setError\(/);
});

test("home map never obtains a new idle GPS fix without a DSH-eligible available Captain", async () => {
  const { readFileSync } = await import("node:fs");
  const opportunities = readFileSync(new URL("./captain-opportunities.tsx", import.meta.url), "utf8");
  const readiness = readFileSync(new URL("./captain-readiness.tsx", import.meta.url), "utf8");
  const gate = opportunities.indexOf('admission.admission.availabilityState !== "available"');
  const gps = opportunities.indexOf("Location.getForegroundPermissionsAsync(");
  assert.ok(opportunities.includes("readOwnCaptainAdmission(token)"));
  assert.ok(opportunities.includes('mission || missionReadiness !== "ready"'));
  assert.ok(gate > 0 && gps > gate, "service eligibility and availability must precede GPS acquisition");
  assert.match(opportunities, /cancelled \|\| current.kind !== "authenticated"/);
  assert.match(readiness, /accessibilityLabel="مفتاح GPS الهاتف"/, "keep the distinct governed GPS control");
  assert.match(readiness, /setBackgroundMissionConsent\(next, actorID, missionAssignmentId\)/);
});
