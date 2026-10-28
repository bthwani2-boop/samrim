import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./primitives.tsx", import.meta.url), "utf8");
const iconButton = source.split("export function BthwaniIconButton(")[1]?.split("export function BthwaniChip(")[0];
const button = source.split("export function BthwaniButton(")[1]?.split("export function BthwaniNavigationRow(")[0];

test("busy shared buttons retain their accessible action name when the visible text becomes a spinner", () => {
  assert.ok(button, "BthwaniButton must remain available to all mobile actors");
  assert.match(button, /accessibilityLabel=\{props\.accessibilityLabel \?\? label\}/);
  assert.match(button, /accessibilityState=\{\{ \.\.\.props\.accessibilityState, busy, disabled: blocked \}\}/);
  assert.match(button, /disabled=\{blocked\}/);
  assert.match(button, /busy \? <ActivityIndicator/);
});

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

test("radio choices announce checked state instead of generic selection across mobile actors", () => {
  assert.match(source, /props\.accessibilityRole === "radio" \? \{ checked: selected \} : \{ selected \}/);
  const radioSurfaces = [
    ["../../../../apps/app-client/src/features/wallet/cash-in-panel.tsx", 3],
    ["../../../../apps/app-captain/src/features/wallet/cash-in-panel.tsx", 2],
    ["../../../../apps/app-partner/src/features/store-offer/partner-store-reels.tsx", 2],
  ];
  for (const [path, expectedCount] of radioSurfaces) {
    const content = readFileSync(new URL(path, import.meta.url), "utf8");
    const states = [...content.matchAll(/accessibilityRole="radio"[\s\S]{0,180}?accessibilityState=\{\{\s*(checked|selected):/g)];
    assert.equal(states.length, expectedCount, `${path}: expected radio state coverage`);
    assert.ok(states.every(([, state]) => state === "checked"), `${path}: radio controls must expose checked`);
  }
  const field = readFileSync(new URL("../../../../apps/app-field/src/features/field-operations/field-new-case.tsx", import.meta.url), "utf8");
  assert.match(field, /<BthwaniChip key=\{provider\.key\} accessibilityRole="radio" disabled=\{formLocked\}/);
  assert.match(field, /selected=\{input\.walletProviderKey === provider\.key\}/);
});
