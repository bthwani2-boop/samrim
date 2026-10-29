import assert from "node:assert/strict";
import { test } from "node:test";
import { ANDROID_EXPO_APPS, androidAppReadiness, androidPermissionStatus } from "./check-android-expo-readiness-core.mjs";

const granted = "versionName=0.3.1\n android.permission.POST_NOTIFICATIONS: granted=true, flags=[ ]\n android.permission.ACCESS_FINE_LOCATION: granted=true, flags=[ ]";
test("readiness inventory excludes the retired Field app", () => {
  assert.deepEqual(Object.keys(ANDROID_EXPO_APPS), ["client", "partner", "captain"]);
});
test("reads permission grants from Android dumpsys rather than package declaration", () => {
  assert.equal(androidPermissionStatus(granted, "POST_NOTIFICATIONS"), "granted");
  assert.equal(androidPermissionStatus(granted, "ACCESS_FINE_LOCATION"), "granted");
  assert.equal(androidPermissionStatus(granted, "ACCESS_BACKGROUND_LOCATION"), "not-granted-or-not-declared");
  assert.equal(androidPermissionStatus(granted.replace("granted=true", "granted=false"), "POST_NOTIFICATIONS"), "denied");
});
test("never claims missing apps or missing permissions are ready", () => {
  assert.equal(androidAppReadiness("", ANDROID_EXPO_APPS.client.requiredForProof).readyForProof, false);
  assert.equal(androidAppReadiness(granted, ANDROID_EXPO_APPS.client.requiredForProof).readyForProof, true);
  assert.equal(androidAppReadiness(granted, ANDROID_EXPO_APPS.captain.requiredForProof).readyForProof, false);
});
