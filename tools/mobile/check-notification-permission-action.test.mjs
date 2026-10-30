import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript-ast";

const root = path.resolve(import.meta.dirname, "../..");
const uiFile = path.resolve(root, "packages/push-device/src/order-alert-preferences.tsx");
const ui = readFileSync(uiFile, "utf8");
const storageFile = path.resolve(root, "packages/push-device/src/alert-tone.ts");
const storage = readFileSync(storageFile, "utf8");

test("shared notification permissions are checked but never prompted without a user tap", () => {
  const ast = ts.createSourceFile(uiFile, ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(ui, /getPermissionsAsync\(\)/);
  assert.match(ui, /status\.granted \? "none" : status\.canAskAgain \? "ask" : "settings"/);
  assert.match(ui, /AppState\.addEventListener\("change"/);
  assert.match(ui, /if \(permissionAction === "settings"\)/);
  assert.match(ui, /await Linking\.openSettings\(\)/);
  assert.match(ui, /if \(permissionAction !== "ask"\) return;/);
  assert.match(ui, /await Notifications\.requestPermissionsAsync\(\)/);
  assert.match(ui, /permissionAction === "ask" \|\| permissionAction === "settings"/);
  assert.match(ui, /onPress=\{\(\) => void enableNotifications\(\)\}/);
  const actionIndex = ui.indexOf("const enableNotifications = async");
  const promptIndex = ui.indexOf("await Notifications.requestPermissionsAsync()");
  assert.ok(actionIndex >= 0 && promptIndex > actionIndex);
  assert.doesNotMatch(ui.slice(0, actionIndex), /requestPermissionsAsync\(\)/);
  assert.doesNotMatch(ui, /import .* from "expo-notifications"/);
});

test("shared UI reinitializes when actor changes and rejects stale async results", () => {
  assert.match(ui, /toneState\.actorID === actorID \? toneState\.tone : "classic"/);
  assert.match(ui, /setToneState\(\{ actorID, tone: "classic" \}\)/);
  assert.match(ui, /\[actorID, readTone, isCurrentActor\]/);
  assert.match(ui, /active && actorRef\.current === actorID && isCurrentActor\(actorID\)/);
  assert.match(ui, /saved && actorRef\.current === selectedActor && isCurrentActor\(selectedActor\)/);
  assert.match(ui, /setToneState\(\{ actorID: selectedActor, tone: value \}\)/);
  assert.doesNotMatch(ui, /currentIdentityState|SecureStore|Crypto\.digestStringAsync/);
  assert.match(storage, /currentOrderAlertTone/);
  assert.match(storage, /actorIDNow\(\) === selectedActor/);
  assert.match(storage, /if \(!isCurrentActor\(selectedActor\)\) return false/);
});

for (const app of ["app-client", "app-partner", "app-captain"]) {
  const file = path.resolve(root, "apps", app, "src/features/notifications/order-alert-preferences.tsx");
  const source = readFileSync(file, "utf8");

  test(app + " subscribes to identity changes and consumes the canonical push-device owner", () => {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0);
    assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentActorID, \(\) => ""\)/);
    assert.match(source, /from "@bthwani\/push-device\/alert-tone"/);
    assert.match(source, /from "@bthwani\/push-device\/order-alert-preferences"/);
    assert.match(source, /currentOrderAlertTone\(currentActorID\)/);
    assert.match(source, /state\.kind === "authenticated"/);
    assert.doesNotMatch(source, /getPermissionsAsync|requestPermissionsAsync|SecureStore|Crypto\.digestStringAsync/);
  });
}
