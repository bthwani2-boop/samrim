import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./presentation/ManagedIdentityFlow.tsx", import.meta.url), "utf8");
const boundaryStart = source.indexOf("export function AuthenticatedMobileBoundary(");
const managedStart = source.indexOf("export function ManagedIdentityFlow(");

test("degraded Identity boundaries announce verification failure without removing retry", () => {
  assert.ok(boundaryStart >= 0 && managedStart > boundaryStart, "canonical Identity boundaries must exist");

  const mobileBoundary = source.slice(boundaryStart, managedStart);
  const managedFlow = source.slice(managedStart);

  assert.match(mobileBoundary, /<Text accessibilityRole="alert" style=\{styles\.stateTitle\}>تعذر التحقق<\/Text>/);
  assert.match(managedFlow, /<Text accessibilityRole="alert" style=\{styles\.title\}>تعذر التحقق<\/Text>/);
  for (const boundary of [mobileBoundary, managedFlow]) {
    assert.match(boundary, /<Pressable accessibilityRole="button" accessibilityState=\{\{ busy, disabled: busy \}\} disabled=\{busy\} onPress=\{\(\) => void restoreSession\(\)\}/);
    assert.match(boundary, /إعادة المحاولة/);
  }
});
