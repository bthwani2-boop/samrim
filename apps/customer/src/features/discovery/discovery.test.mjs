import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("promotions are not presented as live content before owner data is connected", () => {
  const screen = readFileSync(new URL("./discovery-content-screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /CapabilityUnavailableScreen/);
  assert.doesNotMatch(screen, /fetch\(|createPromotion\(|checkout\(/);
});
