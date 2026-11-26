import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { nativeConfigViolations, sourceViolations, verifyRtl } from "./verify-rtl.mjs";

const screen = "apps/customer/app/index.tsx";
const document = "apps/customer/app/+html.tsx";
const rootDocument = 'export default function Document(){return <html lang="ar" dir="rtl"><body /></html>;}';
const nativeConfig = 'plugins.push(["expo-localization",{supportedLocales:{ios:["ar"],android:["ar"]},forcesRTL:true,allowDynamicLocaleChangesAndroid:false}]);';

function rejected(source, file = screen) {
  assert.ok(sourceViolations(source, file).length, "Unexpectedly admitted: " + source);
}

test("logical presentation and harmless prose remain admitted", () => {
  for (const source of [
    'import {Stack} from "expo-router"; const view = <Stack />;',
    'const style = {justifyContent:"flex-end",alignItems:"stretch",textAlign:"auto"};',
    'const style = {textAlign: compact ? "center" : "auto",flexDirection:"row"};',
    'const style = {textAlign:"center" as const};',
    '// I18nManager.forceRTL(true)\nconst label = "textAlign: right";',
    'import {I18nManager as NativeDirection} from "react-native"; const rtl=NativeDirection.isRTL;',
  ]) assert.deepEqual(sourceViolations(source, screen), [], source);
});

test("every runtime native direction mutation and alias is rejected", () => {
  for (const source of [
    'I18nManager.forceRTL(true);',
    'I18nManager["forceRTL"](true);',
    'I18nManager?.allowRTL(false);',
    'I18nManager["swapLeftAndRightInRTL"](false);',
    'import {I18nManager as Direction} from "react-native"; Direction.forceRTL(true);',
    'const {forceRTL}=I18nManager; forceRTL(true);',
    'const direction=I18nManager; direction.allowRTL(true);',
    'I18nManager[key](true);',
    'import {LocaleProvider as Provider} from "expo-router"; <Provider />;',
  ]) rejected(source);
});

test("physical layout values are rejected structurally in every supported property form", () => {
  for (const source of [
    'const style={textAlign:"right"};',
    'const style={"textAlign":"left"};',
    'const style={["textAlign"]:"right"};',
    'const style={textAlign: compact ? "center" : "right"};',
    'const style={textAlign:"right" as const};',
    'const style={textAlign:"ri"+"ght"};',
    'const style={textAlign: unknown};',
    'const style={flexDirection:"row-reverse"};',
    'const style={writingDirection:"ltr"};',
    'const style={direction:"rtl"};',
    'style.textAlign="left";',
    '<Input textAlign={"left"} />;',
    '<View dir="rtl" />;',
    '<View direction="ltr" />;',
    '<View dir={value} />;',
  ]) rejected(source);
});

test("only the actual exported Arabic document root owns explicit direction", () => {
  assert.deepEqual(sourceViolations(rootDocument, document), []);
  assert.deepEqual(sourceViolations('export default function Document(){return <html {...htmlAttributes} lang="ar" dir="rtl"><body/></html>;}', document), []);
  for (const source of [
    '<html lang="ar" dir="rtl"></html>',
    'export default function Document(){return <View><html lang="ar" dir="rtl"></html></View>;}',
    rootDocument.replace(' dir="rtl"', ""),
    rootDocument.replace('lang="ar"', 'lang="en"'),
    rootDocument.replace('dir="rtl"', 'dir="ltr"'),
    rootDocument.replace('dir="rtl"', 'dir="rtl" {...attrs}'),
    rootDocument.replace('<body />', '<body dir="rtl" />'),
    rootDocument.replace('<body />', '<body><html dir="rtl"/></body>'),
    rootDocument + '\nI18nManager.forceRTL(true);',
  ]) rejected(source, document);
  rejected(rootDocument, "apps/customer/src/features/copied/app/+html.tsx");
  rejected(rootDocument, "apps/captain/app/+html.tsx");
});

test("invalid syntax fails closed, while valid JS, TS and JSX are admitted", () => {
  rejected('const x = {', screen);
  for (const file of ["screen.ts", "screen.mts", "screen.cts", "screen.js", "screen.mjs", "screen.cjs", "screen.jsx", "screen.tsx"]) {
    const source = 'const style = {textAlign:"center"};';
    assert.deepEqual(sourceViolations(source, "apps/customer/src/" + file), []);
  }
});

test("native configuration has exactly one explicit Arabic RTL declaration", () => {
  assert.deepEqual(nativeConfigViolations(nativeConfig), []);
  for (const source of [
    'const plugins=[];',
    nativeConfig + nativeConfig,
    nativeConfig.replace("forcesRTL:true","forcesRTL:false"),
    nativeConfig.replace('android:["ar"]','android:["en"]'),
    nativeConfig.replace("forcesRTL:true","forcesRTL:true,supportsRTL:false"),
    nativeConfig.replace("forcesRTL:true","forcesRTL:true,...other"),
    nativeConfig.replace("allowDynamicLocaleChangesAndroid:false","allowDynamicLocaleChangesAndroid:true"),
    nativeConfig.replace("forcesRTL:true","forcesRTL:true,forcesRTL:false"),
  ]) assert.ok(nativeConfigViolations(source).length, source);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bthwani-rtl-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, content) => {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };
  for (const app of ["customer", "merchant", "captain"]) mkdirSync(join(root,"apps",app,"app"), { recursive: true });
  for (const app of ["customer", "merchant"]) put("apps/"+app+"/app/+html.tsx", rootDocument);
  for (const pkg of ["design-system","tamagui-config"]) mkdirSync(join(root,"packages",pkg,"src"), { recursive: true });
  put("tools/mobile/define-bthwani-expo-app.cjs", nativeConfig);
  return {root,put};
}

test("source inventory covers all authored app and shared rendering formats but not isolated tests", t => {
  const {root,put}=fixture(t);
  put("apps/customer/app/index.tsx", "export default function Screen(){return null;}");
  put("apps/merchant/src/build/layout.mts", 'export const style={textAlign:"right"};');
  put("apps/captain/src/features/dispatch/layout.MJS", 'I18nManager.allowRTL(false);');
  put("packages/tamagui-config/src/shared.tsx", '<View dir="rtl"/>;');
  put("packages/design-system/src/shared.ts", 'const style={textAlign:"left"};');
  put("apps/customer/src/features/layout.test.mjs", 'I18nManager.forceRTL(true);');
  const result=verifyRtl(root);
  assert.equal(result.filesChecked,7);
  for (const name of ["src/build/layout.mts","layout.MJS","tamagui-config/src/shared.tsx","design-system/src/shared.ts"]) {
    assert.ok(result.issues.some(issue=>issue.includes(name)),name);
  }
  assert.equal(result.issues.length,4);
});

test("missing canonical documents and linked source entries fail closed", t => {
  const {root,put}=fixture(t);
  rmSync(join(root,"apps/customer/app/+html.tsx"));
  const target=put("apps/merchant/src/ordinary.ts",'const x=1;');
  linkSync(target,join(root,"apps/merchant/src/hardlink.ts"));
  const outside=join(root,"outside");
  mkdirSync(outside);
  writeFileSync(join(outside,"external.tsx"),'I18nManager.forceRTL(true);');
  try { symlinkSync(outside,join(root,"apps/captain/src"),"junction"); }
  catch(error) { if (["EPERM","EACCES","ENOTSUP"].includes(error.code)) return t.skip("junctions unavailable"); throw error; }
  const result=verifyRtl(root);
  assert.ok(result.issues.some(issue=>issue.includes("apps/customer/app/+html.tsx")));
  assert.ok(result.issues.some(issue=>issue.includes("hardlink.ts")));
  assert.ok(result.issues.some(issue=>issue.includes("apps/captain/src")));
  assert.ok(!result.issues.some(issue=>issue.includes("external.tsx")));
});

test("live three Expo hosts and shared presentation source pass the static guard", () => {
  const {filesChecked,issues}=verifyRtl();
  assert.ok(filesChecked>=9);
  assert.deepEqual(issues,[]);
});
