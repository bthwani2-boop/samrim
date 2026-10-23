import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./captain-deliveries.tsx", import.meta.url), "utf8");

test("captain delivery screen never owns GPS publishing or a movement trail", () => {
  for (const forbidden of [
    "expo-location",
    "watchPositionAsync(",
    "getCurrentPositionAsync(",
    "requestForegroundPermissionsAsync(",
    "updateCaptainLocation(",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("captain delivery retains store and customer map markers", () => {
  assert.equal(source.includes("coordinate: task.pickupOrigin"), true);
  assert.equal(source.includes("coordinate: task.customerDestination"), true);
  assert.equal(source.includes('label="الاتجاهات إلى المتجر"'), true);
  assert.equal(source.includes('label="الاتجاهات إلى العميل"'), true);
  assert.equal(source.includes("maps/dir/?api=1&destination="), true);
});

test("dispatch presence stays periodic and separate from the active mission publisher", () => {
  const fs = readFileSync;
  const backend = fs(new URL("../../../../../services/dsh/backend/internal/transport/http/captain.go", import.meta.url), "utf8");
  const clientBackend = fs(new URL("../../../../../services/dsh/backend/internal/transport/http/order.go", import.meta.url), "utf8");
  const publisher = fs(new URL("./captain-presence-publisher.tsx", import.meta.url), "utf8");
  assert.equal(backend.includes('/assignments/{assignmentId}/location"'), false);
  assert.equal(clientBackend.includes('/orders/{orderId}/tracking"'), false);
  assert.equal(publisher.includes("getCurrentPositionAsync"), true);
  assert.equal(publisher.includes("watchPositionAsync"), false);
  const mission = fs(new URL("./captain-mission-location-publisher.tsx", import.meta.url), "utf8");
  assert.equal(mission.includes("Location.watchPositionAsync({"), true);
  assert.equal(mission.includes("distanceInterval: 0,"), true);
  assert.equal(mission.includes('AppState.currentState !== "active"'), true);
  assert.equal(mission.includes('Location.getForegroundPermissionsAsync()'), true);
  assert.equal(mission.includes('task.task.fulfillmentMode !== "BTHWANI_CAPTAIN"'), true);
  assert.equal(mission.includes('/assignments/${encodeURIComponent(targetAssignment)}/mission-location'), true);
  assert.equal(mission.includes("startLocationUpdatesAsync"), false,
    "Background location is not implemented and must not be claimed to work");
});


test("only Operations has a mission-location read route and the server checks permission", () => {
  const http = readFileSync(new URL("../../../../../services/dsh/backend/internal/transport/http/mission_location.go", import.meta.url), "utf8");
  const order = readFileSync(new URL("../../../../../services/dsh/backend/internal/order/service.go", import.meta.url), "utf8");
  const captainHttp = readFileSync(new URL("../../../../../services/dsh/backend/internal/transport/http/captain.go", import.meta.url), "utf8");
  const opsBff = readFileSync(new URL("../../../../control-panel/app/api/operations/[orderId]/mission-location/route.ts", import.meta.url), "utf8");
  assert.equal(http.includes("readOperatorMissionLocation"), true);
  assert.equal(order.includes('s.requireOperatorPermission(ctx, actorID, "operations")'), true);
  assert.equal(captainHttp.includes('POST /dsh/captains/me/assignments/{assignmentId}/mission-location'), true);
  assert.equal(opsBff.includes('operatorWorkspacePermissionDenied(identity, "operations")'), true);
  assert.equal(opsBff.includes('readOperatorSession()'), true);
  assert.equal(opsBff.includes('Cache-Control'), true);
});

test("unverified captain mission does not disclose cached customer destination", () => {
  const home = readFileSync(new URL("../../../app/(app)/home.tsx", import.meta.url), "utf8");
  assert.match(home, /<CaptainOpportunities mission=\{missionReadiness === "ready" \? mission : null\}/);
  assert.match(home, /missionActive=\{missionReadiness === "ready" && Boolean\(mission\)\}/);
  assert.match(home, /suppressed=\{Boolean\(mission\) \|\| missionReadiness !== "ready"\}/);
});

test("client order detail does not expose live captain locations", () => {
  const clientDetail = readFileSync(new URL("../../../../app-client/src/features/orders/order-detail.tsx", import.meta.url), "utf8");
  assert.equal(clientDetail.includes("captainLocation"), false);
  assert.equal(clientDetail.includes("readClientOrderTracking"), false);
  assert.equal(clientDetail.includes("التتبع المباشر"), false);
});
