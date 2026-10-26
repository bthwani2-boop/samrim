import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captainProtectedReturnTo, captainReturnPathPattern } from "./captain-route.ts";

test("captain protects internal offer return links and preserves only the supported order query", () => {
  assert.equal(captainProtectedReturnTo("/offers", "order/42"), "/offers?q=order%2F42");
  assert.equal(captainProtectedReturnTo("/offers", ["order-42", "ignored"]), "/offers?q=order-42");
  assert.equal(captainProtectedReturnTo("/offers", undefined), "/offers");
  assert.equal(captainProtectedReturnTo("/deliveries", "ignored"), "/deliveries");
});

test("captain login return path admits protected routes and rejects external or unrecognized query routes", () => {
  assert.equal(captainReturnPathPattern.test("/offers"), true);
  assert.equal(captainReturnPathPattern.test("/offers?q=order-42"), true);
  assert.equal(captainReturnPathPattern.test("/deliveries"), true);
  assert.equal(captainReturnPathPattern.test("//outside.example"), false);
  assert.equal(captainReturnPathPattern.test("/offers?next=/account"), false);
});

test("protected Captain destinations are in the root stack and remain outside the tab bar", () => {
  const rootLayout = readFileSync(new URL("../../../app/_layout.tsx", import.meta.url), "utf8");
  const tabsLayout = readFileSync(new URL("../../../app/(app)/_layout.tsx", import.meta.url), "utf8");
  const offersRoute = readFileSync(new URL("../../../app/offers.tsx", import.meta.url), "utf8");
  const deliveriesRoute = readFileSync(new URL("../../../app/deliveries.tsx", import.meta.url), "utf8");
  const protectedScreen = readFileSync(new URL("../../../src/shell/captain-protected-screen.tsx", import.meta.url), "utf8");

  assert.match(rootLayout, /<Stack\.Screen name="offers"/u);
  assert.match(rootLayout, /<Stack\.Screen name="deliveries"/u);
  assert.doesNotMatch(tabsLayout, /Tabs\.Screen name="(?:offers|deliveries)"/u);
  assert.match(offersRoute, /<CaptainProtectedScreen>/u);
  assert.match(deliveriesRoute, /<CaptainProtectedScreen>/u);
  assert.match(rootLayout, /<CaptainPresencePublisher \/>/u);
  assert.match(rootLayout, /<CaptainMissionLocationPublisher \/>/u);
  assert.doesNotMatch(tabsLayout, /Captain(?:Presence|MissionLocation)Publisher/u);
  assert.doesNotMatch(protectedScreen, /Captain(?:Presence|MissionLocation)Publisher/u);
});
