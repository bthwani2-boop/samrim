import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("notification UI does not claim delivery or acceptance from local events", () => {
  const inbox=readFileSync(resolve(import.meta.dirname,"notifications-inbox.tsx"),"utf8");
  const monitor=readFileSync(resolve(import.meta.dirname,"order-alert-monitor.tsx"),"utf8");
  assert.ok(inbox.includes("Identity") && inbox.includes("DSH"));
  assert.ok(monitor.includes("hasActiveMission"));
  assert.doesNotMatch(monitor,/acceptOffer\s*\(|completeDelivery\s*\(/);
});
