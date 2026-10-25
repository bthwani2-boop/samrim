import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript-ast";

for (const app of ["app-client", "app-partner", "app-captain"]) {
  const file = path.resolve(import.meta.dirname, "../../apps", app, "src/features/notifications/order-alert-preferences.tsx");
  const source = readFileSync(file, "utf8");

  test(`${app} offers an explicit permission action without auto-opening Android settings`, () => {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0);
    assert.match(source, /getPermissionsAsync\(\)/);
    assert.match(source, /status\.granted \? "none" : status\.canAskAgain \? "ask" : "settings"/);
    assert.match(source, /AppState\.addEventListener\("change"/);
    assert.match(source, /if \(permissionAction === "settings"\)/);
    assert.match(source, /await Linking\.openSettings\(\)/);
    assert.match(source, /if \(permissionAction !== "ask"\) return;/);
    assert.match(source, /await Notifications\.requestPermissionsAsync\(\)/);
    assert.match(source, /permissionAction === "ask" \|\| permissionAction === "settings"/);
    assert.match(source, /onPress=\{\(\) => void enableNotifications\(\)\}/);

    // The OS permission prompt is only reachable from an explicit button.
    const userAction = source.indexOf("const enableNotifications = async");
    const prompt = source.indexOf("await Notifications.requestPermissionsAsync()");
    assert.ok(userAction >= 0 && prompt > userAction);
    assert.doesNotMatch(source.slice(0, userAction), /requestPermissionsAsync\(\)/);
    assert.doesNotMatch(source, /import .* from "expo-notifications"/);
  });
}
