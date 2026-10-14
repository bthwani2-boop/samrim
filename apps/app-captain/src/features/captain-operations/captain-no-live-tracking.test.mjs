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
});
