import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const readiness = read("./captain-readiness.tsx");
const opportunities = read("./captain-opportunities.tsx");
const presence = read("./captain-presence-publisher.tsx");

test("availability and device GPS remain distinct canonical controls", () => {
  assert.equal((readiness.match(/accessibilityLabel="مفتاح توفر الكابتن"/g) ?? []).length, 2);
  assert.equal((readiness.match(/accessibilityLabel="مفتاح GPS الهاتف"/g) ?? []).length, 2);
  assert.match(readiness, /async function togglePhoneGps\(next: boolean\)/);
  assert.match(readiness, /if \(missionActive \|\| available\)/);
  assert.match(readiness, /await openPhoneLocationSettings\(\)/);
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
  assert.match(presence, /if \(!isCurrent\(\) \|\| !available\) return;/);
  assert.match(presence, /readOwnCaptainAdmission\(token\)/);
  assert.match(readiness, /setBackgroundMissionConsent\(next, actorID, missionAssignmentId\)/);
});

test("mission location recovery is explicit and independent of dispatch availability", () => {
  const start = readiness.indexOf("async function recoverPhoneLocation(onlyGps = false)");
  const end = readiness.indexOf("async function toggleBackground(", start);
  assert.ok(start > 0 && end > start);
  const recovery = readiness.slice(start, end);
  assert.match(recovery, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.doesNotMatch(recovery, /setCaptainAvailability\(/);
  assert.match(recovery, /if \(!forMission && !onlyGps\) \{/);
  assert.match(readiness, /!gpsReady && \(missionActive \|\| \(!visibleStoreOnly && available\)\)/);
  assert.match(readiness, /!permission\.canAskAgain/);
  assert.match(readiness, /Linking\.openSettings\(\)/);
});

test("cancelled or renewed Captain Identity session cannot start a location fix after permission awaits", () => {
  const scopeStart = opportunities.indexOf("const requestSession = sessionKey;");
  const scopeEnd = opportunities.indexOf("void refresh();", scopeStart);
  assert.ok(scopeStart > 0 && scopeEnd > scopeStart);
  const sessionGuard = opportunities.slice(scopeStart, scopeEnd);
  assert.match(sessionGuard, /const isCurrent = \(\) => !cancelled && Boolean\(requestSession\)/);
  assert.match(sessionGuard, /captainSessionKey\(currentIdentityState\(\)\) === requestSession/);

  const start = opportunities.indexOf("const [permission, enabled]");
  const end = opportunities.indexOf("const fix = cached", start);
  assert.ok(start > 0 && end > start);
  const gate = opportunities.slice(start, end);
  assert.match(gate, /if \(!isCurrent\(\) \|\| !permission\.granted \|\| !enabled\) return;/);
  assert.match(gate, /if \(!isCurrent\(\)\) return;/);
  assert.ok(gate.indexOf("if (!isCurrent() || !permission.granted")
    < gate.indexOf("Location.getLastKnownPositionAsync"));
  assert.ok(gate.indexOf("if (!isCurrent()) return;")
    > gate.indexOf("Location.getLastKnownPositionAsync"));
});

test("confirmed availability change re-triggers the canonical GPS map gate", () => {
  const home = read("../../../app/(app)/home.tsx");
  assert.match(readiness, /onAvailabilityConfirmed\?\.\(\)/);
  assert.match(home, /availabilityRevision=\{availabilityRevision\}/);
  assert.match(home, /onAvailabilityConfirmed=\{onAvailabilityConfirmed\}/);
  assert.match(opportunities, /void availabilityRevision/);
});

test("available Captain recovers GPS without changing canonical availability", () => {
  const start = readiness.indexOf("async function recoverPhoneLocation(onlyGps = false)");
  const end = readiness.indexOf("async function toggleBackground(", start);
  assert.ok(start > 0 && end > start);
  const recovery = readiness.slice(start, end);
  assert.match(recovery, /!onlyGps && \(missionActive \? !missionAssignmentId : !available\)/);
  assert.match(recovery, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.match(recovery, /await enablePhoneLocationServices\(isCurrent\)/);
  assert.match(readiness, /async function enablePhoneLocationServices\(isCurrent: \(\) => boolean\)/);
  assert.match(readiness, /Location\.enableNetworkProviderAsync\(\)/);
  assert.match(readiness, /Linking\.openSettings\(\)/);
  assert.equal((readiness.match(/await enablePhoneLocationServices\(isCurrent\)/g) ?? []).length, 2,
    "both availability and mission GPS recovery must reuse the same OS owner");
  assert.doesNotMatch(recovery, /setCaptainAvailability\(/);
  assert.match(recovery, /onAvailabilityConfirmed\?\.\(\)/);
  assert.match(recovery, /publishCaptainPresence\(true\)/);
  assert.match(presence, /admission\.admission\.availabilityState === "available"/);
  assert.match(presence, /captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
  assert.match(readiness, /available && !gpsReady \? <BthwaniButton/);
  assert.match(readiness, /!gpsReady && \(missionActive \|\| \(!visibleStoreOnly && available\)\)/);
  assert.match(readiness, /onPress=\{\(\) => void recoverPhoneLocation\(\)\}/);
});
