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

test("mission location recovery is explicit and independent of dispatch availability", () => {
  const start = readiness.indexOf("async function requestMissionLocation()");
  const end = readiness.indexOf("async function toggleBackground(", start);
  assert.ok(start > 0 && end > start);
  const recovery = readiness.slice(start, end);
  assert.match(recovery, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.doesNotMatch(recovery, /setCaptainAvailability|publishCaptainPresence/);
  assert.match(readiness, /missionActive && !gpsReady \? <BthwaniButton/);
  assert.match(readiness, /!permission\.canAskAgain/);
  assert.match(readiness, /Linking\.openSettings\(\)/);
});

test("cancelled or switched actor cannot start a location fix after permission awaits", () => {
  const start = opportunities.indexOf("const [permission, enabled]");
  const end = opportunities.indexOf("const fix = cached", start);
  assert.ok(start > 0 && end > start);
  const gate = opportunities.slice(start, end);
  assert.match(gate, /if \(cancelled \|\| !permission\.granted/);
  assert.match(gate, /if \(cancelled \|\| afterCache\.kind !== "authenticated"/);
  assert.ok(gate.indexOf("if (cancelled") < gate.indexOf("Location.getLastKnownPositionAsync"));
});

test("confirmed availability change re-triggers the canonical GPS map gate", () => {
  const home = read("../../../app/(app)/home.tsx");
  assert.match(readiness, /onAvailabilityConfirmed\?\.\(\)/);
  assert.match(home, /availabilityRevision=\{availabilityRevision\}/);
  assert.match(home, /onAvailabilityConfirmed=\{onAvailabilityConfirmed\}/);
  assert.match(opportunities, /void availabilityRevision/);
});
