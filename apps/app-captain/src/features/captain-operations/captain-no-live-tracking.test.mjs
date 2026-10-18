import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./captain-deliveries.tsx", import.meta.url), "utf8");

test("captain delivery screen does not request or publish live GPS", () => {
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

test("captain GPS is reserved for active dispatch presence, not assignment tracking", () => {
  const fs = readFileSync;
  const backend = fs(new URL("../../../../../services/dsh/backend/internal/transport/http/captain.go", import.meta.url), "utf8");
  const clientBackend = fs(new URL("../../../../../services/dsh/backend/internal/transport/http/order.go", import.meta.url), "utf8");
  const publisher = fs(new URL("./captain-presence-publisher.tsx", import.meta.url), "utf8");
  assert.equal(backend.includes('/assignments/{assignmentId}/location"'), false);
  assert.equal(clientBackend.includes('/orders/{orderId}/tracking"'), false);
  assert.equal(publisher.includes("getCurrentPositionAsync"), true);
  assert.equal(publisher.includes("watchPositionAsync"), false);
});

test("client order detail does not expose live captain locations", () => {
  const clientDetail = readFileSync(new URL("../../../../app-client/src/features/orders/order-detail.tsx", import.meta.url), "utf8");
  assert.equal(clientDetail.includes("captainLocation"), false);
  assert.equal(clientDetail.includes("readClientOrderTracking"), false);
  assert.equal(clientDetail.includes("التتبع المباشر"), false);
});
