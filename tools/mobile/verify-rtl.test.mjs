import assert from "node:assert/strict";
import test from "node:test";
import { nativeConfigViolations, sourceViolations, verifyRtl } from "./verify-rtl.mjs";

test("does not forbid logical layout properties or native-default navigation", () => {
  const source = "import { Stack } from 'expo-router';\nconst view = <Stack />;\nconst style = { justifyContent: 'flex-end', alignItems: 'stretch' };";
  assert.deepEqual(sourceViolations(source, "apps/customer/app/_layout.tsx"), []);
});

test("catches old LocaleProvider even in nested future feature screens", () => {
  const issues = sourceViolations("import {LocaleProvider} from 'expo-router';\n<LocaleProvider direction='rtl' />",
    "apps/merchant/src/features/stores/screen.tsx");
  assert.ok(issues.some(issue => issue.includes("manual LocaleProvider")));
  assert.ok(issues.some(issue => issue.includes("direction override")));
});

test("catches fixed text alignment and reverse-row overrides", () => {
  const source = "const a = { textAlign: 'right', flexDirection: 'row-reverse' };\n<Input textAlign={\"left\"} />";
  const issues = sourceViolations(source, "apps/captain/app/index.tsx");
  assert.equal(issues.filter(issue => issue.includes("physical text alignment")).length, 2);
  assert.ok(issues.some(issue => issue.includes("reverse")));
});

test("catches runtime forceRTL calls and screen-local HTML dir", () => {
  const source = "I18nManager.forceRTL(true);\n<View dir='rtl' />";
  const issues = sourceViolations(source, "apps/customer/app/screen.tsx");
  assert.equal(issues.length, 2);
});

test("allows document-level RTL only at Expo Web +html boundary", () => {
  assert.deepEqual(sourceViolations('<html lang="ar" dir="rtl">', "apps/customer/app/+html.tsx"), []);
  assert.equal(sourceViolations('<View dir="rtl"/>', "apps/customer/app/index.tsx").length, 1);
});

test("fails when canonical native RTL locale is missing or disabled", () => {
  assert.ok(nativeConfigViolations("const plugins = [];").length >= 2);
  const valid = 'plugins.push(["expo-localization", { supportedLocales: { ios: ["ar"], android: ["ar"] }, forcesRTL: true }]);';
  assert.deepEqual(nativeConfigViolations(valid), []);
  assert.ok(nativeConfigViolations(valid.replace("forcesRTL: true", "forcesRTL: false")).length);
});

test("live Stage-4 Expo route trees have no screen-local RTL overrides", () => {
  const { filesChecked, issues } = verifyRtl();
  assert.ok(filesChecked >= 9, "every Expo host must have its source routes inspected");
  assert.deepEqual(issues, []);
});
