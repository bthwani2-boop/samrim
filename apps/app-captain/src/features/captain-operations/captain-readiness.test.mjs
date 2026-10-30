import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const readiness = read("./captain-readiness.tsx");
const opportunities = read("./captain-opportunities.tsx");
const presence = read("./captain-presence-publisher.tsx");

test("the Captain has one availability control, not a separate phone GPS switch", () => {
  assert.equal((readiness.match(/accessibilityLabel="مفتاح توفر الكابتن"/g) ?? []).length, 2);
  assert.doesNotMatch(readiness, /مفتاح GPS الهاتف|togglePhoneGps/);
  assert.match(readiness, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.match(readiness, /Location\.enableNetworkProviderAsync\(\)/);
  assert.ok(readiness.indexOf("Location.enableNetworkProviderAsync()") <
    readiness.indexOf("setCaptainAvailability(token, next, current.version)"));
  assert.match(readiness, /Location\.hasServicesEnabledAsync\(\)/);
});

test("inactive Captains do not acquire a new GPS fix just to center the map", () => {
  assert.match(opportunities, /readOwnCaptainAdmission\(token\)/);
  assert.match(opportunities, /admission\.admission\.availabilityState !== "available"/);
  assert.ok(opportunities.indexOf('availabilityState !== "available"') <
    opportunities.indexOf("Location.getCurrentPositionAsync("));
});

test("dispatch location remains availability-gated while mission tracking is separate", () => {
  assert.match(presence, /shouldPublishCaptainPresence\(/);
  assert.match(presence, /readOwnCaptainAdmission\(token\)/);
  assert.match(readiness, /setBackgroundMissionConsent\(next, actorID, missionAssignmentId\)/);
});
