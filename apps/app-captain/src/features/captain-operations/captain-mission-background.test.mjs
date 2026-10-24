import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const task = read("./captain-mission-location-background.ts");
const publisher = read("./captain-mission-location-publisher.tsx");
const entry = read("../../../index.js");
const readiness = read("./captain-readiness.tsx");
const config = read("../../../app.config.ts");
const shared = read("../../../../../tools/mobile/define-samrim-expo-app.cjs");

test("native headless task is registered before Expo Router entry", () => {
  assert.ok(entry.indexOf("captain-mission-location-background") < entry.indexOf("expo-router/entry"));
  assert.match(task, /TaskManager\?\.defineTask/);
  assert.match(task, /try \{ return require\("expo-task-manager"\)/);
  assert.match(task, /NATIVE_BACKGROUND_LOCATION_BUILD_REQUIRED/);
  assert.match(task, /Location\.startLocationUpdatesAsync/);
  assert.match(config, /locationMode: "background"/);
  assert.match(shared, /isAndroidBackgroundLocationEnabled: true/);
  assert.match(shared, /isAndroidForegroundServiceEnabled: true/);
});

test("mission background service is consent-based and scoped to live owner", () => {
  assert.match(readiness, /setBackgroundMissionConsent\(next, actorID, missionAssignmentId\)/);
  assert.match(task, /Location\.requestBackgroundPermissionsAsync\(\)/);
  assert.match(task, /SecureStore\.getItemAsync\(ENABLED_KEY\)/);
  assert.match(task, /listOwnCaptainAssignments\(token\)/);
  assert.match(task, /readOwnCaptainDeliveryTask\(token, scope\.assignment\)/);
  assert.match(task, /session\.identity\.subject !== scope\.actor/);
  assert.match(task, /Location\.stopLocationUpdatesAsync\(MISSION_LOCATION_TASK\)/);
  assert.match(publisher, /AppState\.currentState !== "active"/);
  assert.match(publisher, /reconcileBackgroundMissionLocation\(actor, candidate\.id\)/);
});

test("background publisher stores no movement trail, never exposes a client endpoint", () => {
  assert.doesNotMatch(task, /AsyncStorage|movementTrail|geofenc/i);
  assert.doesNotMatch(task, /client\/orders\/|\/tracking|customerDestination/);
  assert.match(task, /const fix = data\.locations\[data\.locations\.length - 1\]/);
  assert.match(task, /\/mission-location/);
  assert.match(task, /notificationTitle:/);
  assert.match(task, /notificationBody:/);
});
