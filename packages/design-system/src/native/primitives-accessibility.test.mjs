import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./primitives.tsx", import.meta.url), "utf8");
const iconButton = source.split("export function BthwaniIconButton(")[1]?.split("export function BthwaniChip(")[0];

test("shared icon button exposes the same disabled state to touch, assistive technology and styling", () => {
  assert.ok(iconButton, "BthwaniIconButton must remain available to mobile consumers");
  assert.match(iconButton, /const disabled = Boolean\(props\.disabled\)/);
  assert.match(iconButton, /accessibilityState=\{\{ \.\.\.props\.accessibilityState, disabled \}\}/);
  assert.match(iconButton, /disabled=\{disabled\}/);
  assert.match(iconButton, /disabled && styles\.iconButtonDisabled/);
  assert.match(iconButton, /state\.pressed && !disabled && styles\.buttonPressed/);
  assert.match(source, /iconButtonDisabled: \{ opacity: opacity\.disabled \}/);
});

test("busy customer favorites and field notification refresh use the shared disabled control", () => {
  const customer = readFileSync(new URL("../../../../apps/app-client/src/features/store-discovery/store-detail.tsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../../../../apps/app-field/src/features/notifications/notifications-inbox.tsx", import.meta.url), "utf8");
  assert.match(customer, /<BthwaniIconButton disabled=\{Boolean\(favoriteOfferBusyID\)\}/);
  assert.match(field, /<BthwaniIconButton disabled=\{Boolean\(busy\) \|\| loading \|\| loadingMore\}/);
});
