import assert from "node:assert/strict";
import test from "node:test";
import { storeSettingsStatus } from "./partner-store-settings-status.ts";

const response = (paused, states) => ({
  availability: { paused },
  orderabilityByMode: states.map(state => ({ state })),
});

test("store settings never equate publication to orderability", () => {
  assert.match(storeSettingsStatus(response(false, ["CLOSED_BY_SCHEDULE"])), /لا توجد/);
  assert.match(storeSettingsStatus(response(true, ["OPEN_FOR_ORDERS"])), /متوقف/);
  assert.match(storeSettingsStatus(response(false, ["OPEN_FOR_ORDERS", "PAUSED"])), /يستقبل الطلبات/);
});
