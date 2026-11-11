import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const owner = path.join(root, "packages/design-system/src/native");
const publicImport = "@bthwani/design-system/native/keyboard-provider";
const exports = JSON.parse(readFileSync(path.join(root, "packages/design-system/package.json"), "utf8")).exports["./native/keyboard-provider"];

test("design system is the only owner of the native and web keyboard providers", () => {
  const native = readFileSync(path.join(owner, "keyboard-provider.tsx"), "utf8");
  const web = readFileSync(path.join(owner, "keyboard-provider.web.tsx"), "utf8");
  assert.match(native, /import \{ KeyboardProvider \} from "react-native-keyboard-controller"/);
  assert.match(native, /return <KeyboardProvider>\{children\}<\/KeyboardProvider>/);
  assert.match(web, /return <>\{children\}<\/>/);
  assert.doesNotMatch(web, /react-native-keyboard-controller/);
  assert.equal(exports["react-native"], "./src/native/keyboard-provider.tsx");
  assert.equal(exports.browser, "./src/native/keyboard-provider.web.tsx");
});

for (const app of ["app-client", "app-partner"]) {
  test(`${app} routes use the shared provider and no longer own duplicate platform files`, () => {
    const appPath = path.join(root, "apps", app);
    const layout = readFileSync(path.join(appPath, "app/_layout.tsx"), "utf8");
    assert.match(layout, /import \{ AppKeyboardProvider \} from "@bthwani\/design-system\/native\/keyboard-provider"/);
    assert.match(layout, /<AppKeyboardProvider>/);
    assert.match(layout, /<\/AppKeyboardProvider>/);
    assert.equal(existsSync(path.join(appPath, "src/bootstrap/keyboard-provider.tsx")), false);
    assert.equal(existsSync(path.join(appPath, "src/bootstrap/keyboard-provider.web.tsx")), false);
  });

  test(`${app} resolves exactly the native and web package entrypoints`, () => {
    const appPath = path.join(root, "apps", app);
    for (const [condition, expected] of [["react-native", "keyboard-provider.tsx"], ["browser", "keyboard-provider.web.tsx"]]) {
      const run = spawnSync(process.execPath,
        [`--conditions=${condition}`, "-p", `require.resolve('${publicImport}')`],
        { cwd: appPath, encoding: "utf8", timeout: 10_000 });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(path.normalize(run.stdout.trim()), path.join(owner, expected));
    }
  });
}
